"""
Tests del script de precios (scripts/actualizar_precios.py).

Correr desde la raíz del repo:
  python -m unittest scripts/test_actualizar_precios.py -v

No usan internet ni el sitio real: la parte HTTP se prueba contra un servidor
falso (http.server en un hilo) que imita el login con cookie httpOnly, el
GET /api/products y el POST /api/gestion/products/bulk.
"""

from __future__ import annotations

import contextlib
import io
import json
import logging
import os
import socket
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import actualizar_precios as ap  # noqa: E402

PRECIOS = Path(__file__).resolve().parent / 'precios'
LISTA_CSV = PRECIOS / 'lista-mercado-ejemplo.csv'
LISTA_XLSX = PRECIOS / 'lista-mercado-ejemplo.xlsx'
PRODUCTOS_JSON = PRECIOS / 'productos-ejemplo.json'
CONFIG_EJEMPLO = PRECIOS / 'margenes.example.json'
AHORA = datetime(2026, 10, 5, 15, 0, tzinfo=timezone.utc)

# Resultado esperado de la lista de ejemplo contra los productos de ejemplo,
# con margenes.example.json. Ejemplos de las cuentas en scripts/precios/README.md (sección 4).
ESPERADO_EJEMPLO = {
    'Tomate': (ap.ESTADO_ACTUALIZAR, 2100),
    'Papa': (ap.ESTADO_SIN_CAMBIOS, 900),
    'Cebolla': (ap.ESTADO_ACTUALIZAR, 1050),
    'Zanahoria': (ap.ESTADO_ACTUALIZAR, 1200),
    'Lechuga': (ap.ESTADO_DUDOSO, None),
    'Acelga': (ap.ESTADO_SIN_CAMBIOS, 900),
    'Perejil': (ap.ESTADO_ACTUALIZAR, 600),
    'Zapallito': (ap.ESTADO_ACTUALIZAR, 1800),
    'Zapallo': (ap.ESTADO_ACTUALIZAR, 980),
    'Jengibre': (ap.ESTADO_ACTUALIZAR, 9.9),
    'Banana': (ap.ESTADO_ACTUALIZAR, 1600),
    'Manzana roja': (ap.ESTADO_ACTUALIZAR, 2200),
    'Manzana verde': (ap.ESTADO_BLOQUEADO_LIMITE, 5800),
    'Naranja': (ap.ESTADO_ACTUALIZAR, 1050),
    'Limón': (ap.ESTADO_ACTUALIZAR, 1350),
    'Palta': (ap.ESTADO_ACTUALIZAR, 1850),
    'Frutilla': (ap.ESTADO_ACTUALIZAR, 2200),
    'Mandarina': (ap.ESTADO_BLOQUEADO_OFERTA, 1200),
    'Kiwi': (ap.ESTADO_ACTUALIZAR, 2900),
    'Berenjena': (ap.ESTADO_ACTUALIZAR, 1800),
    'Pimiento rojo': (ap.ESTADO_ACTUALIZAR, 3900),
    'Pimiento verde': (ap.ESTADO_ACTUALIZAR, 2850),
    'Ajo': (ap.ESTADO_REVISAR, None),
    'Choclo': (ap.ESTADO_ACTUALIZAR, 450),
    'Rúcula': (ap.ESTADO_SIN_MATCH, None),
    'Carbón (bolsa 4 kg)': (ap.ESTADO_SIN_MATCH, None),
    'Bolsón verdulero': (ap.ESTADO_EXCLUIDO, None),
    'Huevos (maple x 30)': (ap.ESTADO_SIN_MATCH, None),
}


# --------------------------------------------------------------------------- #
# Ayudas                                                                      #
# --------------------------------------------------------------------------- #


def producto(identificador, nombre, precio=1000.0, unidad='kg', categoria='Verduras', disponible=True, oferta=None, vence=None):
    return ap.ProductoTienda(
        id=identificador, nombre=nombre, precio=precio, unidad=unidad, categoria=categoria,
        disponible=disponible, precio_oferta=oferta, oferta_vence=vence,
    )


def renglon(nombre, precio=1000.0, presentacion='', kilos=None, unidades=None, por_kg=False, fila=2):
    leida = ap.parse_presentacion(presentacion) if presentacion else ap.Presentacion()
    return ap.RenglonLista(
        fila=fila, nombre=nombre, precio=precio, presentacion=presentacion,
        kilos_bulto=kilos or leida.kilos, unidades_bulto=unidades or leida.unidades,
        por_kg=por_kg or leida.por_kg,
    )


def lista(*renglones):
    return ap.ListaMercado(
        renglones=list(renglones), columnas={}, hoja=None, fila_encabezado=1, precio_por_kg_por_encabezado=False,
    )


def config(**cambios):
    base = ap.Configuracion(redondeo=ap.Redondeo('arriba', ((None, 50.0),)))
    for clave, valor in cambios.items():
        setattr(base, clave, valor)
    return base


def fila_de(plan, nombre):
    return next(fila for fila in plan.filas if fila.producto.nombre == nombre)


class Base(unittest.TestCase):
    def setUp(self):
        # Los avisos del script no tienen que ensuciar la salida de los tests.
        if not ap.log.handlers:
            ap.log.addHandler(logging.NullHandler())
        ap.log.propagate = False


# --------------------------------------------------------------------------- #
# Servidor falso                                                              #
# --------------------------------------------------------------------------- #


class ServidorFalso:
    """Imita la API del sitio. Guarda todo lo que recibe para poder verificarlo."""

    USUARIO = 'duenio'
    PASSWORD = 'clave-de-prueba'
    TOKEN = 'token-de-prueba'

    def __init__(self, productos):
        self.productos = {item['id']: dict(item) for item in productos}
        self.pedidos = []  # (método, ruta, headers)
        self.lotes = []  # cuerpos válidos que llegaron al bulk
        self.fallas = {}  # ruta -> respuestas (status, cuerpo, headers) a devolver antes de atender bien
        self.rechazar_ids = set()  # el bulk responde 400 con "index" si viene alguno de estos ids
        self.bulk_500_desde = None  # a partir de esta llamada al bulk, siempre 500
        self._llamadas_bulk = 0
        self._lock = threading.Lock()

    def __enter__(self):
        servidor = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                servidor._atender(self, 'GET')

            def do_POST(self):
                servidor._atender(self, 'POST')

        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        self.hilo = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.hilo.start()
        return self

    def __exit__(self, *args):
        self.httpd.shutdown()
        self.httpd.server_close()

    def llamadas(self, ruta):
        return [pedido for pedido in self.pedidos if pedido[1] == ruta]

    @staticmethod
    def _responder(handler, status, cuerpo, headers=None):
        datos = json.dumps(cuerpo).encode()
        handler.send_response(status)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Content-Length', str(len(datos)))
        for nombre, valor in (headers or {}).items():
            handler.send_header(nombre, valor)
        handler.end_headers()
        handler.wfile.write(datos)

    def _atender(self, handler, metodo):
        largo = int(handler.headers.get('Content-Length') or 0)
        cuerpo = json.loads(handler.rfile.read(largo)) if largo else None
        ruta = handler.path
        with self._lock:
            self.pedidos.append((metodo, ruta, dict(handler.headers)))
            pendientes = self.fallas.get(ruta)
            forzada = pendientes.pop(0) if pendientes else None
        if forzada:
            return self._responder(handler, *forzada)

        if metodo == 'POST' and ruta == '/api/gestion/login':
            if cuerpo == {'username': self.USUARIO, 'password': self.PASSWORD}:
                cookie = f'{ap.COOKIE_SESION}={self.TOKEN}; Path=/api/gestion; HttpOnly; SameSite=Strict; Max-Age=43200'
                return self._responder(handler, 200, {'ok': True}, {'Set-Cookie': cookie})
            return self._responder(handler, 401, {'error': 'Usuario o contraseña incorrectos.'})

        if metodo == 'GET' and ruta == '/api/products':
            return self._responder(handler, 200, list(self.productos.values()))

        if metodo == 'POST' and ruta == '/api/gestion/products/bulk':
            if f'{ap.COOKIE_SESION}={self.TOKEN}' not in handler.headers.get('Cookie', ''):
                return self._responder(handler, 401, {'error': 'No autorizado. Iniciá sesión.'})
            with self._lock:
                self._llamadas_bulk += 1
                numero = self._llamadas_bulk
            if self.bulk_500_desde is not None and numero >= self.bulk_500_desde:
                return self._responder(handler, 500, {'error': 'No se pudieron actualizar los productos.'})
            updates = (cuerpo or {}).get('updates')
            if not isinstance(updates, list) or not updates or len(updates) > ap.MAX_LOTE_SERVIDOR:
                return self._responder(handler, 400, {'error': 'Mandá "updates" con al menos una actualización.'})
            ids = [item.get('id') for item in updates]
            if len(set(ids)) != len(ids):
                return self._responder(handler, 400, {'error': 'El mismo producto viene dos veces.'})
            for indice, item in enumerate(updates):
                if item['id'] in self.rechazar_ids:
                    return self._responder(handler, 400, {'error': f'Ítem {indice + 1}: no válido.', 'index': indice})
            self.lotes.append(updates)
            no_encontrados = []
            for item in updates:
                guardado = self.productos.get(item['id'])
                if guardado is None:
                    no_encontrados.append(item['id'])
                    continue
                if 'price' in item:
                    guardado['price'] = item['price']
                if 'available' in item:
                    guardado['available'] = item['available']
            return self._responder(handler, 200, {'updated': len(updates) - len(no_encontrados), 'notFound': no_encontrados})

        return self._responder(handler, 404, {'error': 'No encontrado.'})


def puerto_cerrado():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def productos_ejemplo():
    return json.loads(PRODUCTOS_JSON.read_text(encoding='utf-8'))


# --------------------------------------------------------------------------- #
# Normalización y números                                                     #
# --------------------------------------------------------------------------- #


class TestNormalizacion(Base):
    def test_tildes_mayusculas_y_signos(self):
        self.assertEqual(ap.normalizar_nombre('LIMÓN'), 'limon')
        self.assertEqual(ap.normalizar_nombre('  Rúcula!! '), 'rucula')

    def test_saca_presentacion_y_calidad(self):
        self.assertEqual(ap.normalizar_nombre('TOMATE PERITA x 18 KG 1ra'), 'tomate perita')
        self.assertEqual(ap.normalizar_nombre('Cajón de tomate primera'), 'tomate')
        self.assertEqual(ap.normalizar_nombre('Papa negra x18kg (2da)'), 'papa negra')

    def test_plurales(self):
        self.assertEqual(ap.normalizar_nombre('Limones'), 'limon')
        self.assertEqual(ap.normalizar_nombre('Zanahorias'), 'zanahoria')
        self.assertEqual(ap.normalizar_nombre('Nueces'), 'nuez')
        self.assertEqual(ap.normalizar_nombre('Ajíes'), 'aji')
        self.assertEqual(ap.normalizar_nombre('Coliflores'), 'coliflor')
        self.assertEqual(ap.normalizar_nombre('Pimientos verdes'), 'pimiento verde')

    def test_parentesis_y_envases(self):
        self.assertEqual(ap.normalizar_nombre('Carbón (bolsa 4 kg)'), 'carbon')
        self.assertEqual(ap.normalizar_nombre('Huevos (maple x 30)'), 'huevo')

    def test_si_no_queda_nada_usa_la_version_liviana(self):
        self.assertEqual(ap.normalizar_nombre('Kg'), 'kg')

    def test_liviano_conserva_las_palabras(self):
        self.assertEqual(ap.normalizar_liviano('Tomate  Perita 1RA'), 'tomate perita 1ra')

    def test_similitud(self):
        self.assertEqual(ap.similitud('pimiento rojo', 'rojo pimiento'), 1.0)
        self.assertGreater(ap.similitud('zapallito', 'zapalito'), 0.9)
        self.assertLess(ap.similitud('lechuga', 'lechuga criolla'), 0.85)
        self.assertEqual(ap.similitud('', 'algo'), 0.0)


class TestNumeros(Base):
    def test_formatos_argentinos(self):
        casos = {
            '$ 25.000': 25000, '25.000,50': 25000.5, '18,5': 18.5, '1250.50': 1250.5,
            '1.250.000': 1250000, '25,000.50': 25000.5, '$25000 x cajón': 25000, '25 000': 25000,
            '$ 7.200,00': 7200, '0,25': 0.25,
        }
        for texto, esperado in casos.items():
            with self.subTest(texto=texto):
                self.assertAlmostEqual(ap.parse_numero(texto), esperado)

    def test_numeros_de_excel_y_vacios(self):
        self.assertEqual(ap.parse_numero(25000), 25000.0)
        self.assertEqual(ap.parse_numero(18.5), 18.5)
        for vacio in (None, '', 'consultar', 'S/P', float('nan'), True):
            with self.subTest(vacio=vacio):
                self.assertIsNone(ap.parse_numero(vacio))

    def test_negativo(self):
        self.assertEqual(ap.parse_numero('-500'), -500)

    def test_formato_pesos(self):
        self.assertEqual(ap.formato_pesos(1388.889), '$ 1.388,89')
        self.assertEqual(ap.formato_pesos(2100), '$ 2.100')
        self.assertEqual(ap.formato_pesos(9.9), '$ 9,9')
        self.assertEqual(ap.formato_pct(-12.5), '-12,5%')


# --------------------------------------------------------------------------- #
# Bultos y conversión                                                         #
# --------------------------------------------------------------------------- #


class TestPresentacion(Base):
    def test_kilos_por_bulto(self):
        casos = {
            'Cajón 18 kg': 18, 'x18kg': 18, 'Bolsa 20 kilos': 20, 'Jaula x 10 kg': 10, '18,5 kg': 18.5,
            'Bolsa 500 g': 0.5, 'Tomate perita 2da x 18 kg': 18, 'Caja 10 x 1 kg': 10,
        }
        for texto, kilos in casos.items():
            with self.subTest(texto=texto):
                self.assertAlmostEqual(ap.parse_presentacion(texto).kilos, kilos)

    def test_unidades_por_bulto(self):
        casos = {'Caja x 10 bandejas': 10, 'Bolsa x 50 u': 50, 'x 12 atados': 12, 'docena': 12, '2 docenas': 24, 'Media docena': 6}
        for texto, unidades in casos.items():
            with self.subTest(texto=texto):
                self.assertEqual(ap.parse_presentacion(texto).unidades, unidades)

    def test_bandejas_con_peso(self):
        leida = ap.parse_presentacion('Caja 12 bandejas x 125 g')
        self.assertEqual(leida.unidades, 12)
        self.assertAlmostEqual(leida.kilos, 1.5)

    def test_precio_por_kilo(self):
        for texto in ('kg', 'x kg', 'Por kilo', 'el kilo', '1 kg'):
            with self.subTest(texto=texto):
                self.assertTrue(ap.parse_presentacion(texto).por_kg)
        self.assertFalse(ap.parse_presentacion('Cajón 18 kg').por_kg)

    def test_una_sola_unidad(self):
        self.assertEqual(ap.parse_presentacion('Atado').unidades, 1)
        self.assertEqual(ap.parse_presentacion('Unidad').unidades, 1)
        bandeja = ap.parse_presentacion('Bandeja 125 g')
        self.assertEqual((bandeja.unidades, bandeja.kilos), (1, 0.125))

    def test_sin_datos(self):
        self.assertEqual(ap.parse_presentacion('Cajón'), ap.Presentacion())
        self.assertEqual(ap.parse_presentacion(''), ap.Presentacion())


class TestConversion(Base):
    def test_cajon_a_kilo(self):
        costo, explicacion = ap.convertir_costo(renglon('TOMATE', 25000, 'Cajón 18 kg'), 'kg')
        self.assertAlmostEqual(costo, 25000 / 18)
        self.assertIn('÷ 18 kg', explicacion)

    def test_cajon_a_gramo(self):
        costo, _ = ap.convertir_costo(renglon('JENGIBRE', 33000, 'Caja 5 kg'), 'g')
        self.assertAlmostEqual(costo, 6.6)

    def test_columna_de_kilos(self):
        costo, _ = ap.convertir_costo(renglon('CEBOLLA', 14000, 'Bolsa', kilos=20), 'kg')
        self.assertAlmostEqual(costo, 700)

    def test_atados_y_bandejas(self):
        self.assertAlmostEqual(ap.convertir_costo(renglon('ACELGA', 7200, 'x 12 atados'), 'atado')[0], 600)
        self.assertAlmostEqual(ap.convertir_costo(renglon('FRUTILLA', 15000, 'Caja x 10 bandejas'), 'bandeja')[0], 1500)

    def test_bandeja_suelta_es_precio_por_bandeja(self):
        # "Bandeja 125 g": el peso describe la bandeja, no un bulto para dividir.
        self.assertEqual(ap.convertir_costo(renglon('ARANDANOS', 1200, 'Bandeja 125 g'), 'bandeja')[0], 1200)
        # Si en la tienda va por kilo, sí se usa el peso.
        self.assertAlmostEqual(ap.convertir_costo(renglon('HONGOS', 1200, 'Bandeja 500 g'), 'kg')[0], 2400)
        # Un precio por unidad no se puede pasar a kilo.
        with self.assertRaises(ap.ErrorConversion):
            ap.convertir_costo(renglon('ZAPALLO', 1500, 'Unidad'), 'kg')

    def test_kilo_a_unidad_necesita_peso_por_unidad(self):
        palta = renglon('PALTA', 20000, 'Caja 4 kg')
        with self.assertRaises(ap.ErrorConversion):
            ap.convertir_costo(palta, 'unidad')
        costo, explicacion = ap.convertir_costo(palta, 'unidad', kg_por_unidad=0.25)
        self.assertAlmostEqual(costo, 1250)
        self.assertIn('0,25 kg por unidad', explicacion)

    def test_unidades_a_kilo_no_se_puede(self):
        with self.assertRaises(ap.ErrorConversion):
            ap.convertir_costo(renglon('CHOCLO', 15000, 'Bolsa x 50 u'), 'kg')

    def test_sin_presentacion_se_toma_tal_cual_con_nota(self):
        costo, explicacion = ap.convertir_costo(renglon('PAPA', 600), 'kg')
        self.assertEqual(costo, 600)
        self.assertIn('se tomó como precio por kg', explicacion)
        self.assertEqual(ap.convertir_costo(renglon('LIMON', 150), 'unidad')[0], 150)

    def test_modo_bulto_exige_kilos(self):
        with self.assertRaises(ap.ErrorConversion):
            ap.convertir_costo(renglon('PAPA', 15000), 'kg', precio_por='bulto')
        with self.assertRaises(ap.ErrorConversion):
            ap.convertir_costo(renglon('CHOCLO', 15000), 'unidad', precio_por='bulto')

    def test_precio_por_kilo_no_divide(self):
        self.assertEqual(ap.convertir_costo(renglon('PAPA', 600, 'Bolsa 25 kg'), 'kg', precio_por='kg')[0], 600)
        self.assertEqual(ap.convertir_costo(renglon('PAPA', 600, 'x kg'), 'kg')[0], 600)

    def test_renglon_sin_precio(self):
        malo = renglon('REPOLLO', None)
        malo.problema = 'precio ilegible ("consultar")'
        with self.assertRaisesRegex(ap.ErrorConversion, 'ilegible'):
            ap.convertir_costo(malo, 'unidad')


# --------------------------------------------------------------------------- #
# Cruce                                                                       #
# --------------------------------------------------------------------------- #


class TestCruce(Base):
    def test_exacto_despues_de_normalizar(self):
        cruce = ap.cruzar([producto(1, 'Zanahoria')], [renglon('ZANAHORIAS x 20 KG')])
        self.assertEqual(cruce.asignados[1].metodo, 'exacto')
        self.assertEqual(cruce.asignados[1].puntaje, 1.0)

    def test_alias(self):
        productos = [producto(1, 'Tomate'), producto(2, 'Tomate cherry')]
        cruce = ap.cruzar(productos, [renglon('Tomate Perita 1ra')], alias={'tomate perita': ['Tomate']})
        self.assertEqual(cruce.asignados[1].metodo, 'alias')
        self.assertNotIn(2, cruce.asignados)

    def test_alias_literal_gana_al_normalizado(self):
        renglones = [renglon('TOMATE PERITA 1RA', fila=2), renglon('TOMATE PERITA 2DA', fila=3)]
        cruce = ap.cruzar([producto(1, 'Tomate')], renglones, alias={'tomate perita 2da': ['Tomate']})
        self.assertEqual(cruce.asignados[1].renglon, 1)
        self.assertIn(0, cruce.sin_usar)

    def test_parecido_por_encima_del_umbral(self):
        cruce = ap.cruzar([producto(1, 'Zapallito')], [renglon('ZAPALITO')], umbral=0.85)
        self.assertEqual(cruce.asignados[1].metodo, 'parecido')

    def test_nunca_asigna_por_debajo_del_umbral(self):
        cruce = ap.cruzar([producto(1, 'Lechuga')], [renglon('LECHUGA CRIOLLA')], umbral=0.85, umbral_dudoso=0.6)
        self.assertNotIn(1, cruce.asignados)
        self.assertIn(1, cruce.dudosos)
        self.assertIn('64%', cruce.dudosos[1][1])
        self.assertIn(0, cruce.sin_usar)
        # Bajando el umbral, el mismo par sí se asigna: el umbral es configurable.
        self.assertIn(1, ap.cruzar([producto(1, 'Lechuga')], [renglon('LECHUGA CRIOLLA')], umbral=0.6).asignados)

    def test_por_debajo_del_dudoso_es_sin_match(self):
        cruce = ap.cruzar([producto(1, 'Kiwi')], [renglon('BATATA')], umbral=0.85, umbral_dudoso=0.6)
        self.assertEqual(cruce.asignados, {})
        self.assertEqual(cruce.dudosos, {})
        self.assertEqual(cruce.sin_usar[0], 'no se parece a ningún producto de la tienda')

    def test_uno_a_uno(self):
        # "Zapallo" se parece 87% a "Zapallito": no se puede llevar el renglón del otro.
        productos = [producto(1, 'Zapallo'), producto(2, 'Zapallito')]
        cruce = ap.cruzar(productos, [renglon('ZAPALLITO')], umbral=0.85)
        self.assertEqual(cruce.asignados[2].renglon, 0)
        self.assertNotIn(1, cruce.asignados)
        self.assertIn('ya se usó para "Zapallito"', cruce.dudosos[1][1])

    def test_renglon_con_alias_no_se_usa_para_otro(self):
        productos = [producto(1, 'Zapallo'), producto(2, 'Zapallito')]
        cruce = ap.cruzar(productos, [renglon('ZAPALLO ANCO')], alias={'zapallo anco': ['Zapallo']})
        self.assertEqual(set(cruce.asignados), {1})
        self.assertNotIn(2, cruce.dudosos)

    def test_empate_usa_el_primero_y_lo_avisa(self):
        renglones = [renglon('TOMATE PERITA 1RA', fila=2), renglon('TOMATE PERITA 2DA', fila=3)]
        cruce = ap.cruzar([producto(1, 'Tomate')], renglones, alias={'tomate perita': ['Tomate']})
        self.assertEqual(cruce.asignados[1].renglon, 0)
        self.assertEqual([c.renglon for c in cruce.empates[1]], [1])
        self.assertIn('ya tomó la fila 2', cruce.sin_usar[1])

    def test_alias_a_un_producto_que_no_existe(self):
        cruce = ap.cruzar([producto(1, 'Tomate')], [renglon('TOMATE')], alias={'tomate perita': ['Tomatito']})
        self.assertEqual(len(cruce.avisos), 1)
        self.assertIn('Tomatito', cruce.avisos[0])
        self.assertIn(1, cruce.asignados)


# --------------------------------------------------------------------------- #
# Precio, redondeo y límites                                                  #
# --------------------------------------------------------------------------- #


class TestPrecio(Base):
    def test_margen_y_redondeo_hacia_arriba(self):
        redondeo = ap.Redondeo('arriba', ((None, 50.0),))
        self.assertEqual(ap.precio_venta(25000 / 18, 50, 'kg', redondeo), 2100)
        self.assertEqual(ap.precio_venta(1400, 50, 'kg', redondeo), 2100)  # 2100 exacto no sube a 2150

    def test_modos(self):
        self.assertEqual(ap.Redondeo('cercano', ((None, 50.0),)).aplicar(2083.33), 2100)
        self.assertEqual(ap.Redondeo('cercano', ((None, 50.0),)).aplicar(2060), 2050)
        self.assertEqual(ap.Redondeo('cercano', ((None, 50.0),)).aplicar(2075), 2100)
        self.assertEqual(ap.Redondeo('abajo', ((None, 50.0),)).aplicar(2083.33), 2050)
        self.assertEqual(ap.Redondeo('arriba', ((None, 100.0),)).aplicar(2001), 2100)

    def test_tramos(self):
        redondeo = ap.Redondeo('arriba', ((1000.0, 10.0), (10000.0, 50.0), (None, 100.0)))
        self.assertEqual(redondeo.aplicar(975), 980)
        self.assertEqual(redondeo.aplicar(1015), 1050)
        self.assertEqual(redondeo.aplicar(15040), 15100)

    def test_gramo_redondea_sobre_el_kilo(self):
        redondeo = ap.Redondeo('arriba', ((None, 50.0),))
        self.assertEqual(ap.precio_venta(6.6, 50, 'g', redondeo), 9.9)
        self.assertEqual(ap.precio_venta(6.61, 50, 'g', redondeo), 9.95)

    def test_margen_por_categoria_producto_y_default(self):
        cfg = config(margenes_pct={'Frutas': 45.0}, margen_default_pct=40.0, margenes_producto_pct={'palta': 60.0})
        self.assertEqual(cfg.margen_para(producto(1, 'Banana', categoria='Frutas')), 45)
        self.assertEqual(cfg.margen_para(producto(2, 'Palta', categoria='Frutas')), 60)
        self.assertEqual(cfg.margen_para(producto(3, 'Huevos', categoria='Almacén')), 40)


class TestLimite(Base):
    def test_excede_limite(self):
        self.assertFalse(ap.excede_limite(1000, 1400, 40))
        self.assertTrue(ap.excede_limite(1000, 1401, 40))
        self.assertFalse(ap.excede_limite(1000, 600, 40))
        self.assertTrue(ap.excede_limite(1000, 599, 40))
        self.assertTrue(ap.excede_limite(0, 500, 40))

    def test_bloquea_sin_forzar_y_aplica_con_forzar(self):
        productos = [producto(1, 'Manzana', precio=2100)]
        datos = lista(renglon('MANZANA', 72000, 'Cajón 18 kg'))
        bloqueado = ap.armar_plan(productos, datos, config(), ap.Opciones(), AHORA)
        self.assertEqual(bloqueado.filas[0].estado, ap.ESTADO_BLOQUEADO_LIMITE)
        self.assertEqual(bloqueado.actualizaciones, [])
        forzado = ap.armar_plan(productos, datos, config(), ap.Opciones(forzar=True), AHORA)
        self.assertEqual(forzado.filas[0].estado, ap.ESTADO_ACTUALIZAR)
        self.assertEqual(forzado.actualizaciones, [{'id': 1, 'price': 6000}])
        self.assertIn('--forzar', forzado.filas[0].detalle)

    def test_precio_actual_cero_se_bloquea(self):
        plan = ap.armar_plan([producto(1, 'Papa', precio=0)], lista(renglon('PAPA', 600, 'x kg')), config(), ap.Opciones(), AHORA)
        self.assertEqual(plan.filas[0].estado, ap.ESTADO_BLOQUEADO_LIMITE)

    def test_oferta_vigente_bloquea(self):
        vigente = producto(1, 'Mandarina', precio=1500, oferta=1300)
        futura = producto(2, 'Pera', precio=1500, oferta=1300, vence=AHORA + timedelta(days=2))
        vencida = producto(3, 'Kiwi', precio=1500, oferta=1300, vence=AHORA - timedelta(days=2))
        datos = lista(renglon('MANDARINA', 800, 'x kg'), renglon('PERA', 800, 'x kg'), renglon('KIWI', 800, 'x kg'))
        plan = ap.armar_plan([vigente, futura, vencida], datos, config(margen_default_pct=50, margenes_pct={}), ap.Opciones(), AHORA)
        self.assertEqual(fila_de(plan, 'Mandarina').estado, ap.ESTADO_BLOQUEADO_OFERTA)
        self.assertEqual(fila_de(plan, 'Pera').estado, ap.ESTADO_BLOQUEADO_OFERTA)
        self.assertEqual(fila_de(plan, 'Kiwi').estado, ap.ESTADO_ACTUALIZAR)

    def test_sin_cambios(self):
        plan = ap.armar_plan([producto(1, 'Papa', precio=900)], lista(renglon('PAPA', 600, 'x kg')), config(margenes_pct={'Verduras': 50.0}), ap.Opciones(), AHORA)
        self.assertEqual(plan.filas[0].estado, ap.ESTADO_SIN_CAMBIOS)
        self.assertEqual(plan.actualizaciones, [])


# --------------------------------------------------------------------------- #
# Lotes y stock                                                               #
# --------------------------------------------------------------------------- #


class TestLotes(Base):
    def test_armar_lotes(self):
        items = [{'id': i, 'price': 100} for i in range(1, 451)]
        lotes = ap.armar_lotes(items, 200)
        self.assertEqual([len(lote) for lote in lotes], [200, 200, 50])
        self.assertEqual([item for lote in lotes for item in lote], items)
        self.assertEqual(ap.armar_lotes([], 200), [])
        self.assertEqual(len(ap.armar_lotes(items[:200])), 1)

    def test_tamano_invalido(self):
        for tamano in (0, ap.MAX_LOTE_SERVIDOR + 1):
            with self.subTest(tamano=tamano), self.assertRaises(ValueError):
                ap.armar_lotes([{'id': 1}], tamano)

    def test_marcar_sin_stock(self):
        productos = [
            producto(1, 'Rúcula', categoria='Verduras'),
            producto(2, 'Carbón', categoria='Almacén'),
            producto(3, 'Lechuga', categoria='Verduras'),
            producto(4, 'Kiwi', categoria='Frutas', disponible=False),
        ]
        datos = lista(renglon('LECHUGA CRIOLLA', 17000, 'Jaula 10 kg'))
        plan = ap.armar_plan(productos, datos, config(), ap.Opciones(marcar_sin_stock=True), AHORA)
        self.assertEqual(fila_de(plan, 'Rúcula').estado, ap.ESTADO_MARCAR_SIN_STOCK)
        self.assertEqual(fila_de(plan, 'Carbón').estado, ap.ESTADO_SIN_MATCH)  # Almacén no se toca
        self.assertEqual(fila_de(plan, 'Lechuga').estado, ap.ESTADO_DUDOSO)  # probablemente sí vino
        self.assertEqual(fila_de(plan, 'Kiwi').estado, ap.ESTADO_SIN_MATCH)  # ya estaba sin stock
        self.assertEqual(plan.actualizaciones, [{'id': 1, 'available': False}])

    def test_sin_la_opcion_no_marca_nada(self):
        plan = ap.armar_plan([producto(1, 'Rúcula')], lista(renglon('TOMATE')), config(), ap.Opciones(), AHORA)
        self.assertEqual(plan.actualizaciones, [])

    def test_reactivar(self):
        productos = [producto(1, 'Berenjena', precio=1500, disponible=False), producto(2, 'Papa', precio=900, disponible=False)]
        datos = lista(renglon('BERENJENA', 14400, 'Cajón 12 kg'), renglon('PAPA', 600, 'x kg'))
        cfg = config(margenes_pct={'Verduras': 50.0})
        plan = ap.armar_plan(productos, datos, cfg, ap.Opciones(reactivar=True), AHORA)
        self.assertEqual(fila_de(plan, 'Berenjena').actualizacion, {'id': 1, 'price': 1800, 'available': True})
        self.assertEqual(fila_de(plan, 'Papa').estado, ap.ESTADO_REACTIVAR)
        self.assertEqual(fila_de(plan, 'Papa').actualizacion, {'id': 2, 'available': True})
        sin_opcion = ap.armar_plan(productos, datos, cfg, ap.Opciones(), AHORA)
        self.assertEqual(sin_opcion.actualizaciones, [{'id': 1, 'price': 1800}])

    def test_excluidos(self):
        productos = [producto(1, 'Bolsón verdulero', categoria='Bolsones'), producto(2, 'Tomate')]
        cfg = config(categorias_excluidas=('Bolsones',), productos_excluidos=frozenset({'tomate'}))
        plan = ap.armar_plan(productos, lista(renglon('BOLSON VERDULERO'), renglon('TOMATE')), cfg, ap.Opciones(), AHORA)
        self.assertTrue(all(fila.estado == ap.ESTADO_EXCLUIDO for fila in plan.filas))
        self.assertEqual(plan.actualizaciones, [])


# --------------------------------------------------------------------------- #
# Lectura de la lista                                                         #
# --------------------------------------------------------------------------- #


class TestLecturaLista(Base):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_csv_windows_con_titulos(self):
        contenido = (
            'MERCADO DE ABASTO DE CÓRDOBA\n'
            'Lista del lunes;;\n'
            '\n'
            'Descripción;Presentación;Precio mayorista\n'
            'LIMÓN;Bolsa 18 kg;$ 16.200\n'
            'FRUTAS;;\n'
            'Descripción;Presentación;Precio mayorista\n'
            'PALTA;Caja 4 kg;20.000,50\n'
        )
        ruta = self.dir / 'lista.csv'
        ruta.write_bytes(contenido.encode('cp1252'))
        datos = ap.leer_lista(ruta)
        self.assertEqual(datos.fila_encabezado, 4)
        self.assertEqual([r.nombre for r in datos.renglones], ['LIMÓN', 'PALTA'])
        self.assertEqual([r.fila for r in datos.renglones], [5, 8])
        self.assertEqual(datos.renglones[0].precio, 16200)
        self.assertEqual(datos.renglones[0].kilos_bulto, 18)
        self.assertEqual(datos.renglones[1].precio, 20000.5)

    def test_csv_con_comas(self):
        ruta = self.dir / 'lista.csv'
        ruta.write_text('articulo,kilos,precio\nPapa,25,"15000"\nCebolla,20,"14.000"\n', encoding='utf-8')
        datos = ap.leer_lista(ruta)
        self.assertEqual(datos.columnas, {'producto': 'articulo', 'kilos': 'kilos', 'precio': 'precio'})
        self.assertEqual([(r.precio, r.kilos_bulto) for r in datos.renglones], [(15000, 25), (14000, 20)])

    def test_encabezado_de_precio_por_kilo(self):
        ruta = self.dir / 'lista.csv'
        ruta.write_text('Producto;Kg x bulto;Precio x kg\nPapa;25;600\n', encoding='utf-8')
        datos = ap.leer_lista(ruta)
        self.assertTrue(datos.precio_por_kg_por_encabezado)
        self.assertTrue(datos.renglones[0].por_kg)
        self.assertEqual(ap.convertir_costo(datos.renglones[0], 'kg')[0], 600)

    def test_presentacion_en_el_nombre(self):
        ruta = self.dir / 'lista.csv'
        ruta.write_text('Producto;Precio\nTOMATE PERITA X 18 KG;25000\n', encoding='utf-8')
        self.assertEqual(ap.leer_lista(ruta).renglones[0].kilos_bulto, 18)

    def test_xlsx_con_titulos(self):
        ruta = self.dir / 'lista.xlsx'
        with pd.ExcelWriter(ruta, engine='openpyxl') as libro:
            pd.DataFrame({'Notas': ['nada']}).to_excel(libro, sheet_name='Portada', index=False)
            tabla = pd.DataFrame({'Artículo': ['KIWI', 'CHOCLO'], 'Unidad': ['Caja 10 kg', 'Bolsa x 50 u'], 'Precio': [20000, '15.000']})
            tabla.to_excel(libro, sheet_name='Precios', index=False, startrow=2)
            libro.sheets['Precios']['A1'] = 'Puesto 14'
        datos = ap.leer_lista(ruta)
        self.assertEqual(datos.hoja, 'Precios')
        self.assertEqual(datos.fila_encabezado, 3)
        self.assertEqual([(r.nombre, r.precio, r.fila) for r in datos.renglones], [('KIWI', 20000, 4), ('CHOCLO', 15000, 5)])
        self.assertEqual(datos.renglones[1].unidades_bulto, 50)

    def test_ejemplos_xlsx_y_csv_dicen_lo_mismo(self):
        desde_csv = ap.leer_lista(LISTA_CSV, ignorar=['flete'])
        desde_xlsx = ap.leer_lista(LISTA_XLSX)

        def resumen(datos):
            return {r.nombre: (r.precio, r.kilos_bulto, r.unidades_bulto) for r in datos.renglones}

        self.assertEqual(resumen(desde_csv), resumen(desde_xlsx))
        self.assertEqual(desde_xlsx.columnas['precio'], 'Precio mayorista ($)')
        self.assertEqual(desde_xlsx.fila_encabezado, 4)

    def test_faltan_columnas_dice_cuales_hay(self):
        ruta = self.dir / 'lista.csv'
        ruta.write_text('Mercadería;Bulto;Monto\nPapa;Bolsa;15000\n', encoding='utf-8')
        with self.assertRaises(ap.ErrorLista) as error:
            ap.leer_lista(ruta)
        mensaje = str(error.exception)
        self.assertIn('precio', mensaje)
        self.assertIn('"Monto"', mensaje)
        self.assertIn('--col-precio', mensaje)
        # Indicándola a mano, anda.
        datos = ap.leer_lista(ruta, columnas={'precio': 'Monto'})
        self.assertEqual(datos.renglones[0].precio, 15000)

    def test_columna_indicada_que_no_existe(self):
        with self.assertRaises(ap.ErrorLista) as error:
            ap.leer_lista(LISTA_CSV, columnas={'precio': 'Precio x bulto'})
        self.assertIn('--col-precio "Precio x bulto"', str(error.exception))
        self.assertIn('"Kg por bulto"', str(error.exception))

    def test_archivo_inexistente_y_formato_raro(self):
        with self.assertRaisesRegex(ap.ErrorLista, 'No encontré el archivo'):
            ap.leer_lista(self.dir / 'no-existe.xlsx')
        raro = self.dir / 'lista.pdf'
        raro.write_text('x')
        with self.assertRaisesRegex(ap.ErrorLista, 'No sé leer'):
            ap.leer_lista(raro)

    def test_hoja_inexistente(self):
        with self.assertRaises(ap.ErrorLista) as error:
            ap.leer_lista(LISTA_XLSX, hoja='Marzo')
        self.assertIn('Lista', str(error.exception))

    def test_secciones_ilegibles_e_ignorados(self):
        datos = ap.leer_lista(LISTA_CSV, ignorar=['flete'])
        nombres = [r.nombre for r in datos.renglones]
        self.assertNotIn('VERDURAS', nombres)
        self.assertNotIn('FRUTAS', nombres)
        self.assertNotIn('FLETE', nombres)
        repollo = next(r for r in datos.renglones if r.nombre == 'REPOLLO')
        self.assertIsNone(repollo.precio)
        self.assertIn('ilegible', repollo.problema)


# --------------------------------------------------------------------------- #
# Configuración                                                               #
# --------------------------------------------------------------------------- #


class TestConfiguracion(Base):
    def test_ejemplo_carga(self):
        cfg = ap.cargar_configuracion(CONFIG_EJEMPLO)
        self.assertEqual(cfg.margenes_pct['Verduras'], 50)
        self.assertEqual(cfg.margen_default_pct, 40)
        self.assertEqual(cfg.limite_cambio_pct, 40)
        self.assertEqual(cfg.umbral_match, 0.85)
        self.assertEqual(cfg.alias['tomate perita'], ['Tomate'])
        self.assertEqual(cfg.kg_por_unidad['palta'], 0.25)
        self.assertEqual(cfg.redondeo.tramos[-1], (None, 100))
        self.assertEqual(cfg.categorias_sin_stock, ('Frutas', 'Verduras'))

    def test_json_invalido(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / 'margenes.json'
            ruta.write_text('{"margenes_pct": {"Frutas": 45,}}', encoding='utf-8')
            with self.assertRaisesRegex(ap.ErrorConfig, 'línea 1'):
                ap.cargar_configuracion(ruta)

    def test_valores_invalidos(self):
        casos = [
            {'margenes_pct': {'Frutas': 'mucho'}},
            {'margenes_pct': {'Panadería': 30}},
            {'limite_cambio_pct': 0},
            {'redondeo': {'modo': 'magico'}},
            {'redondeo': {'tramos': [{'hasta': 5000, 'multiplo': 50}, {'hasta': 1000, 'multiplo': 10}]}},
            {'alias': {'tomate perita': 3}},
            {'precio_por': 'cajon'},
            {'categorias_sin_stock': ['Lácteos']},
            {'umbral_match': 0.5, 'umbral_dudoso': 0.7},
            {'columnas': {'proveedor': 'Puesto'}},
        ]
        for datos in casos:
            with self.subTest(datos=datos), self.assertRaises(ap.ErrorConfig):
                ap.configuracion_desde_dict(datos)

    def test_tolerancias(self):
        cfg = ap.configuracion_desde_dict({
            'margenes_pct': {'almacen': 30, 'DEFAULT': 35}, 'umbral_match': 90, 'redondeo': 100,
            '_comentario': 'se ignora',
        })
        self.assertEqual(cfg.margenes_pct, {'Almacén': 30})
        self.assertEqual(cfg.margen_default_pct, 35)
        self.assertEqual(cfg.umbral_match, 0.9)
        self.assertEqual(cfg.redondeo.aplicar(2001), 2100)

    def test_clave_desconocida_avisa(self):
        with self.assertLogs(ap.log, level='WARNING') as avisos:
            ap.configuracion_desde_dict({'margen': {'Frutas': 45}})
        self.assertIn('"margen"', avisos.output[0])


# --------------------------------------------------------------------------- #
# HTTP                                                                        #
# --------------------------------------------------------------------------- #


class TestHttp(Base):
    def cliente(self, url, esperas=None, reintentos=3):
        return ap.ClienteApi(url, reintentos=reintentos, dormir=(esperas.append if esperas is not None else lambda _s: None), timeout=(2, 5))

    def test_login_cookie_y_bulk(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            cliente = self.cliente(servidor.url)
            cliente.iniciar_sesion(ServidorFalso.USUARIO, ServidorFalso.PASSWORD)
            productos = cliente.obtener_productos()
            self.assertEqual(len(productos), 28)
            respuesta = cliente.enviar_lote([{'id': 1, 'price': 2100}, {'id': 999, 'price': 10}])
            self.assertEqual(respuesta, {'updated': 1, 'notFound': [999]})
            self.assertEqual(servidor.productos[1]['price'], 2100)

            bulk = servidor.llamadas('/api/gestion/products/bulk')[0][2]
            self.assertIn(f'{ap.COOKIE_SESION}={ServidorFalso.TOKEN}', bulk.get('Cookie', ''))
            self.assertNotIn('Origin', bulk)  # el middleware frena los Origin ajenos
            # La cookie tiene Path=/api/gestion: no viaja al catálogo público.
            catalogo = servidor.llamadas('/api/products')[0][2]
            self.assertNotIn('Cookie', catalogo)

    def test_login_incorrecto_no_reintenta(self):
        with ServidorFalso([]) as servidor:
            esperas = []
            with self.assertRaisesRegex(ap.ErrorLogin, 'incorrectos'):
                self.cliente(servidor.url, esperas).iniciar_sesion('duenio', 'mal')
            self.assertEqual(len(servidor.llamadas('/api/gestion/login')), 1)
            self.assertEqual(esperas, [])

    def test_login_bloqueado_429_no_reintenta(self):
        with ServidorFalso([]) as servidor:
            servidor.fallas['/api/gestion/login'] = [(429, {'error': 'Demasiados intentos.'}, {'Retry-After': '540'})]
            esperas = []
            with self.assertRaisesRegex(ap.ErrorLogin, '9 minutos'):
                self.cliente(servidor.url, esperas).iniciar_sesion(ServidorFalso.USUARIO, ServidorFalso.PASSWORD)
            self.assertEqual(len(servidor.llamadas('/api/gestion/login')), 1)
            self.assertEqual(esperas, [])

    def test_reintenta_5xx_con_backoff(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            servidor.fallas['/api/products'] = [(503, {'error': 'caído'}, None), (502, {'error': 'caído'}, None)]
            esperas = []
            productos = self.cliente(servidor.url, esperas).obtener_productos()
            self.assertEqual(len(productos), 28)
            self.assertEqual(len(servidor.llamadas('/api/products')), 3)
            self.assertEqual(len(esperas), 2)
            self.assertLess(esperas[0], esperas[1])  # backoff exponencial

    def test_5xx_persistente(self):
        with ServidorFalso([]) as servidor:
            servidor.fallas['/api/products'] = [(500, {'error': 'roto'}, None)] * 10
            esperas = []
            with self.assertRaisesRegex(ap.ErrorApi, 'error \\(500: roto\\)'):
                self.cliente(servidor.url, esperas, reintentos=2).obtener_productos()
            self.assertEqual(len(servidor.llamadas('/api/products')), 3)
            self.assertEqual(len(esperas), 2)

    def test_429_respeta_retry_after(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            esperas = []
            cliente = self.cliente(servidor.url, esperas)
            cliente.iniciar_sesion(ServidorFalso.USUARIO, ServidorFalso.PASSWORD)
            servidor.fallas['/api/gestion/products/bulk'] = [(429, {'error': 'Esperá.'}, {'Retry-After': '7'})]
            self.assertEqual(cliente.enviar_lote([{'id': 1, 'price': 2000}])['updated'], 1)
            self.assertEqual(esperas, [7.0])

    def test_retry_after_demasiado_largo(self):
        with ServidorFalso([]) as servidor:
            servidor.fallas['/api/products'] = [(429, {'error': 'Esperá.'}, {'Retry-After': '900'})]
            esperas = []
            with self.assertRaisesRegex(ap.ErrorApi, '15 minutos'):
                self.cliente(servidor.url, esperas).obtener_productos()
            self.assertEqual(esperas, [])

    def test_4xx_no_se_reintenta(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            esperas = []
            cliente = self.cliente(servidor.url, esperas)
            cliente.iniciar_sesion(ServidorFalso.USUARIO, ServidorFalso.PASSWORD)
            servidor.rechazar_ids = {5}
            with self.assertRaises(ap.ErrorLoteRechazado) as error:
                cliente.enviar_lote([{'id': 1, 'price': 2000}, {'id': 5, 'price': 10}])
            self.assertEqual(error.exception.indice, 1)
            self.assertEqual(len(servidor.llamadas('/api/gestion/products/bulk')), 1)
            self.assertEqual(esperas, [])

    def test_bulk_sin_sesion(self):
        with ServidorFalso([]) as servidor, self.assertRaisesRegex(ap.ErrorLogin, '401'):
            self.cliente(servidor.url).enviar_lote([{'id': 1, 'price': 1}])

    def test_sitio_caido(self):
        esperas = []
        cliente = self.cliente(f'http://127.0.0.1:{puerto_cerrado()}', esperas, reintentos=2)
        with self.assertRaisesRegex(ap.ErrorApi, 'no se pudo conectar después de 3 intentos'):
            cliente.obtener_productos()
        self.assertEqual(len(esperas), 2)

    def test_redireccion_no_se_sigue(self):
        with ServidorFalso([]) as servidor:
            servidor.fallas['/api/gestion/login'] = [(308, {}, {'Location': 'https://otro.example/api/gestion/login'})]
            with self.assertRaisesRegex(ap.ErrorApi, 'redirige a https://otro.example'):
                self.cliente(servidor.url).iniciar_sesion('a', 'b')

    def test_404_es_url_equivocada(self):
        with ServidorFalso([]) as servidor:
            servidor.fallas['/api/products'] = [(404, {'error': 'No encontrado.'}, None)]
            with self.assertRaisesRegex(ap.ErrorApi, '¿La dirección es la del sitio?'):
                self.cliente(servidor.url).obtener_productos()

    def test_retry_after_como_fecha(self):
        respuesta = mock.Mock(headers={'Retry-After': 'Wed, 21 Oct 2099 07:28:00 GMT'})
        self.assertGreater(ap._segundos_retry_after(respuesta), 1e6)
        self.assertEqual(ap._segundos_retry_after(mock.Mock(headers={'Retry-After': '12'})), 12)
        self.assertIsNone(ap._segundos_retry_after(mock.Mock(headers={})))
        self.assertIsNone(ap._segundos_retry_after(mock.Mock(headers={'Retry-After': 'pronto'})))

    def test_url_invalida(self):
        with self.assertRaises(ap.ErrorConfig):
            ap.ClienteApi('elpampa.vercel.app')
        self.assertEqual(ap.normalizar_url('https://elpampa.vercel.app/'), 'https://elpampa.vercel.app')


class TestAplicar(Base):
    def plan_con(self, cantidad):
        productos = [producto(i, f'Producto {i}', precio=1000) for i in range(1, cantidad + 1)]
        plan = ap.Plan(filas=[], dudosos=[], sin_usar=[], avisos=[])
        for item in productos:
            plan.filas.append(ap.FilaPlan(
                producto=item, estado=ap.ESTADO_ACTUALIZAR, precio_nuevo=1100,
                actualizacion={'id': item.id, 'price': 1100},
            ))
        return plan

    def servidor_con(self, cantidad):
        return ServidorFalso([
            {'id': i, 'name': f'Producto {i}', 'price': 1000, 'unit': 'kg', 'category': 'Verduras', 'available': True}
            for i in range(1, cantidad + 1)
        ])

    def test_lotes_de_hasta_200(self):
        with self.servidor_con(450) as servidor:
            cliente = ap.ClienteApi(servidor.url, dormir=lambda _s: None)
            cliente.iniciar_sesion(ServidorFalso.USUARIO, ServidorFalso.PASSWORD)
            plan = self.plan_con(450)
            resultado = ap.aplicar_cambios(cliente, plan, 200)
            self.assertEqual([len(lote) for lote in servidor.lotes], [200, 200, 50])
            self.assertEqual(resultado.aplicados, 450)
            self.assertEqual(ap._codigo_resultado(resultado), ap.EXIT_OK)
            self.assertTrue(all(fila.estado == ap.ESTADO_ACTUALIZADO for fila in plan.filas))

    def test_item_rechazado_se_saca_y_se_reenvia_el_resto(self):
        with self.servidor_con(5) as servidor:
            servidor.rechazar_ids = {3}
            cliente = ap.ClienteApi(servidor.url, dormir=lambda _s: None)
            cliente.iniciar_sesion(ServidorFalso.USUARIO, ServidorFalso.PASSWORD)
            plan = self.plan_con(5)
            resultado = ap.aplicar_cambios(cliente, plan, 200)
            self.assertEqual(resultado.aplicados, 4)
            self.assertEqual(resultado.rechazados, 1)
            self.assertEqual([item['id'] for item in servidor.lotes[0]], [1, 2, 4, 5])
            self.assertEqual(fila_de(plan, 'Producto 3').estado, ap.ESTADO_RECHAZADO)
            self.assertIn('no válido', fila_de(plan, 'Producto 3').detalle)
            self.assertEqual(ap._codigo_resultado(resultado), ap.EXIT_PARCIAL)

    def test_producto_borrado_en_el_medio(self):
        with self.servidor_con(2) as servidor:
            cliente = ap.ClienteApi(servidor.url, dormir=lambda _s: None)
            cliente.iniciar_sesion(ServidorFalso.USUARIO, ServidorFalso.PASSWORD)
            plan = self.plan_con(3)  # el 3 no existe en el sitio
            resultado = ap.aplicar_cambios(cliente, plan, 200)
            self.assertEqual((resultado.aplicados, resultado.no_encontrados), (2, 1))
            self.assertEqual(fila_de(plan, 'Producto 3').estado, ap.ESTADO_NO_ENCONTRADO)
            self.assertEqual(ap._codigo_resultado(resultado), ap.EXIT_OK)

    def test_ctrl_c_durante_el_envio(self):
        class ClienteQueSeCorta:
            def __init__(self):
                self.llamadas = 0

            def enviar_lote(self, lote):
                self.llamadas += 1
                if self.llamadas == 2:
                    raise KeyboardInterrupt
                return {'updated': len(lote), 'notFound': []}

        plan = self.plan_con(3)
        resultado = ap.aplicar_cambios(ClienteQueSeCorta(), plan, 1)
        self.assertTrue(resultado.interrumpido)
        self.assertEqual([fila.estado for fila in plan.filas], [ap.ESTADO_ACTUALIZADO, ap.ESTADO_INTERRUMPIDO, ap.ESTADO_INTERRUMPIDO])
        self.assertEqual(ap._codigo_resultado(resultado), ap.EXIT_INTERRUMPIDO)

    def test_sitio_cae_a_mitad_de_camino(self):
        with self.servidor_con(5) as servidor:
            servidor.bulk_500_desde = 2
            cliente = ap.ClienteApi(servidor.url, reintentos=1, dormir=lambda _s: None)
            cliente.iniciar_sesion(ServidorFalso.USUARIO, ServidorFalso.PASSWORD)
            plan = self.plan_con(5)
            resultado = ap.aplicar_cambios(cliente, plan, 2)
            self.assertEqual(resultado.aplicados, 2)
            self.assertEqual(resultado.no_enviados, 3)
            self.assertIsInstance(resultado.error_fatal, ap.ErrorApi)
            self.assertEqual([fila.estado for fila in plan.filas], [ap.ESTADO_ACTUALIZADO] * 2 + [ap.ESTADO_NO_ENVIADO] * 3)
            self.assertEqual(ap._codigo_resultado(resultado), ap.EXIT_PARCIAL)


# --------------------------------------------------------------------------- #
# De punta a punta                                                            #
# --------------------------------------------------------------------------- #


class TestPuntaAPunta(Base):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.salida = ['--dir-reportes', str(self.dir / 'reportes'), '--dir-logs', str(self.dir / 'logs')]

    def tearDown(self):
        self.tmp.cleanup()

    def correr(self, *argumentos, entorno=None):
        consola = io.StringIO()
        with contextlib.redirect_stderr(consola), mock.patch.dict(os.environ, entorno or {}, clear=False):
            for variable in ('ELPAMPA_USER', 'ELPAMPA_PASSWORD', 'ELPAMPA_URL'):
                if variable not in (entorno or {}):
                    os.environ.pop(variable, None)
            codigo = ap.main([*argumentos, *self.salida], dormir=lambda _s: None, interactivo=False)
        return codigo, consola.getvalue()

    def reporte(self, modo='simulacion'):
        archivos = sorted((self.dir / 'reportes').glob(f'reporte-precios-*-{modo}.xlsx'))
        self.assertEqual(len(archivos), 1)
        return archivos[0]

    def verificar_estados(self, tabla):
        obtenido = {
            fila['Producto']: (fila['Estado'], None if pd.isna(fila['Precio nuevo']) else fila['Precio nuevo'])
            for fila in tabla.to_dict('records')
        }
        for nombre, (estado, precio) in ESPERADO_EJEMPLO.items():
            with self.subTest(producto=nombre):
                self.assertEqual(obtenido[nombre][0], estado)
                if precio is not None:
                    self.assertAlmostEqual(obtenido[nombre][1], precio)

    def test_simulacion_con_csv(self):
        codigo, consola = self.correr(str(LISTA_CSV), '--productos-json', str(PRODUCTOS_JSON), '--config', str(CONFIG_EJEMPLO))
        self.assertEqual(codigo, ap.EXIT_OK, consola)
        libro = self.reporte()
        with pd.ExcelFile(libro) as excel:
            self.assertEqual(excel.sheet_names, ['Productos', 'Matches dudosos', 'Lista sin usar', 'Resumen'])
        self.verificar_estados(pd.read_excel(libro, 'Productos'))
        dudosos = pd.read_excel(libro, 'Matches dudosos')
        self.assertEqual(dudosos['Producto'].tolist(), ['Lechuga'])
        sin_usar = pd.read_excel(libro, 'Lista sin usar')
        self.assertEqual(sorted(sin_usar['Renglón de la lista']), ['BATATA', 'LECHUGA CRIOLLA', 'REPOLLO', 'TOMATE PERITA 2DA'])
        csv_principal = next((self.dir / 'reportes').glob('reporte-precios-*-simulacion.csv'))
        tabla_csv = pd.read_csv(csv_principal, sep=';', decimal=',', encoding='utf-8-sig')
        self.verificar_estados(tabla_csv)
        self.assertEqual(len(list((self.dir / 'logs').glob('*.log'))), 1)
        # Lo que necesita atención se avisa en la consola aunque se corra con -q.
        self.assertIn('Manzana verde', consola)

    def test_simulacion_con_xlsx(self):
        codigo, consola = self.correr(str(LISTA_XLSX), '--productos-json', str(PRODUCTOS_JSON), '--config', str(CONFIG_EJEMPLO), '-q')
        self.assertEqual(codigo, ap.EXIT_OK, consola)
        self.verificar_estados(pd.read_excel(self.reporte(), 'Productos'))

    def test_aplicar_contra_el_servidor_falso(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            codigo, consola = self.correr(
                str(LISTA_CSV), '--config', str(CONFIG_EJEMPLO), '--url', servidor.url,
                '--aplicar', '--marcar-sin-stock', '--reactivar', '-q',
                entorno={'ELPAMPA_USER': ServidorFalso.USUARIO, 'ELPAMPA_PASSWORD': ServidorFalso.PASSWORD},
            )
            self.assertEqual(codigo, ap.EXIT_OK, consola)
            self.assertEqual(len(servidor.lotes), 1)
            enviados = {item['id']: item for item in servidor.lotes[0]}
            self.assertEqual(enviados[1], {'id': 1, 'price': 2100})  # Tomate
            self.assertEqual(enviados[10], {'id': 10, 'price': 9.9})  # Jengibre, por gramo
            self.assertEqual(enviados[20], {'id': 20, 'price': 1800, 'available': True})  # Berenjena vuelve
            self.assertEqual(enviados[25], {'id': 25, 'available': False})  # Rúcula no vino
            self.assertNotIn(13, enviados)  # Manzana verde: bloqueada por límite
            self.assertNotIn(18, enviados)  # Mandarina: bloqueada por oferta
            self.assertNotIn(26, enviados)  # Carbón: Almacén no pasa a sin stock
            self.assertEqual(len(enviados), 19)  # 18 precios + Rúcula a sin stock
            self.assertEqual(servidor.productos[25]['available'], False)
            tabla = pd.read_excel(self.reporte('aplicado'), 'Productos')
            estados = dict(zip(tabla['Producto'], tabla['Estado'], strict=True))
            self.assertEqual(estados['Tomate'], ap.ESTADO_ACTUALIZADO)
            self.assertEqual(estados['Rúcula'], ap.ESTADO_MARCADO_SIN_STOCK)
            self.assertEqual(estados['Manzana verde'], ap.ESTADO_BLOQUEADO_LIMITE)

    def test_aplicar_con_rechazo_parcial(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            servidor.rechazar_ids = {1}
            codigo, consola = self.correr(
                str(LISTA_CSV), '--config', str(CONFIG_EJEMPLO), '--url', servidor.url, '--aplicar', '-q',
                entorno={'ELPAMPA_USER': ServidorFalso.USUARIO, 'ELPAMPA_PASSWORD': ServidorFalso.PASSWORD},
            )
            self.assertEqual(codigo, ap.EXIT_PARCIAL, consola)
            self.assertEqual(len(servidor.lotes[0]), 17)

    def test_terminal_interactiva_pide_credenciales_y_confirmacion(self):
        argumentos = [str(LISTA_CSV), '--config', str(CONFIG_EJEMPLO), '--aplicar', '-q', *self.salida]
        for respuesta, lotes_esperados in (('no', 0), ('si', 1)):
            with self.subTest(respuesta=respuesta), ServidorFalso(productos_ejemplo()) as servidor:
                with mock.patch.dict(os.environ, {}, clear=False), \
                        mock.patch('builtins.input', side_effect=[ServidorFalso.USUARIO, respuesta]) as pedir, \
                        mock.patch('getpass.getpass', return_value=ServidorFalso.PASSWORD) as clave, \
                        contextlib.redirect_stderr(io.StringIO()):
                    os.environ.pop('ELPAMPA_USER', None)
                    os.environ.pop('ELPAMPA_PASSWORD', None)
                    codigo = ap.main([*argumentos, '--url', servidor.url], dormir=lambda _s: None, interactivo=True)
                self.assertEqual(codigo, ap.EXIT_OK)
                self.assertEqual(pedir.call_count, 2)
                self.assertEqual(clave.call_count, 1)
                self.assertEqual(len(servidor.lotes), lotes_esperados)

    def test_aplicar_sin_credenciales(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            codigo, consola = self.correr(str(LISTA_CSV), '--config', str(CONFIG_EJEMPLO), '--url', servidor.url, '--aplicar')
            self.assertEqual(codigo, ap.EXIT_LOGIN)
            self.assertIn('ELPAMPA_USER', consola)
            self.assertEqual(servidor.pedidos, [])

    def test_aplicar_con_clave_incorrecta(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            codigo, consola = self.correr(
                str(LISTA_CSV), '--config', str(CONFIG_EJEMPLO), '--url', servidor.url, '--aplicar',
                entorno={'ELPAMPA_USER': 'duenio', 'ELPAMPA_PASSWORD': 'clave-equivocada-123'},
            )
            self.assertEqual(codigo, ap.EXIT_LOGIN)
            self.assertNotIn('clave-equivocada-123', consola)  # la contraseña nunca se muestra

    def test_simulacion_no_inicia_sesion(self):
        with ServidorFalso(productos_ejemplo()) as servidor:
            codigo, consola = self.correr(str(LISTA_CSV), '--config', str(CONFIG_EJEMPLO), '--url', servidor.url, '-q')
            self.assertEqual(codigo, ap.EXIT_OK, consola)
            self.assertEqual([pedido[1] for pedido in servidor.pedidos], ['/api/products'])

    def test_sitio_caido(self):
        codigo, consola = self.correr(
            str(LISTA_CSV), '--config', str(CONFIG_EJEMPLO), '--url', f'http://127.0.0.1:{puerto_cerrado()}', '--reintentos', '1',
        )
        self.assertEqual(codigo, ap.EXIT_API)
        self.assertIn('no se pudo conectar', consola)

    def test_errores_de_uso_y_de_archivos(self):
        with self.assertRaises(SystemExit) as salida, contextlib.redirect_stderr(io.StringIO()):
            ap.main([str(LISTA_CSV), '--aplicar', '--productos-json', str(PRODUCTOS_JSON)])
        self.assertEqual(salida.exception.code, ap.EXIT_USO)

        codigo, consola = self.correr(str(self.dir / 'no-existe.xlsx'), '--productos-json', str(PRODUCTOS_JSON), '--config', str(CONFIG_EJEMPLO))
        self.assertEqual(codigo, ap.EXIT_LISTA)
        self.assertIn('No encontré el archivo', consola)

        roto = self.dir / 'roto.json'
        roto.write_text('{', encoding='utf-8')
        codigo, _ = self.correr(str(LISTA_CSV), '--productos-json', str(PRODUCTOS_JSON), '--config', str(roto))
        self.assertEqual(codigo, ap.EXIT_CONFIG)

    def test_ayuda_en_castellano(self):
        salida = io.StringIO()
        with self.assertRaises(SystemExit) as fin, contextlib.redirect_stdout(salida):
            ap.main(['--help'])
        self.assertEqual(fin.exception.code, 0)
        texto = salida.getvalue()
        self.assertIn('uso:', texto)
        self.assertIn('--aplicar', texto)
        self.assertIn('ejemplos:', texto)
        self.assertIn('códigos de salida:', texto)


class TestSeguridad(unittest.TestCase):
    """Hallazgos de la auditoría de seguridad."""

    def test_nunca_manda_la_contrasena_por_http_a_otro_host(self):
        cliente = ap.ClienteApi('http://elpampa.example', reintentos=0, dormir=lambda _segundos: None)
        with mock.patch.object(cliente, '_pedir') as pedir:
            with self.assertRaises(ap.ErrorLogin):
                cliente.iniciar_sesion('admin', 'clave-que-no-tiene-que-salir')
            pedir.assert_not_called()

    def test_http_a_localhost_sigue_permitido_para_pruebas(self):
        for url in ('http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'):
            cliente = ap.ClienteApi(url, reintentos=0, dormir=lambda _segundos: None)
            with mock.patch.object(cliente, '_pedir') as pedir:
                pedir.side_effect = ap.ErrorLogin('cortado a propósito')
                with self.assertRaises(ap.ErrorLogin):
                    cliente.iniciar_sesion('admin', 'x')
                pedir.assert_called_once()

    def test_textos_que_parecen_formulas_no_se_ejecutan_en_el_reporte(self):
        tabla = pd.DataFrame([{'Renglón de la lista': '=HYPERLINK("https://evil.example","x")', 'Precio': 10}])
        seguro = ap._sin_formulas(tabla)
        self.assertTrue(seguro.iloc[0]['Renglón de la lista'].startswith("'="))
        self.assertEqual(seguro.iloc[0]['Precio'], 10)
        for prefijo in ('+', '-', '@'):
            self.assertEqual(ap._texto_seguro(f'{prefijo}cmd'), f"'{prefijo}cmd")
        self.assertEqual(ap._texto_seguro('Tomate'), 'Tomate')


if __name__ == '__main__':
    unittest.main()
