#!/usr/bin/env python3
"""
Actualización de precios de El Pampa a partir de la lista del Mercado de Abasto.

Lee la lista mayorista (Excel o CSV), la cruza por nombre con los productos de
la tienda, calcula el precio de venta con el margen de cada categoría y el
redondeo comercial, y genera un reporte para revisar. Recién con --aplicar
manda los cambios al sitio (POST /api/gestion/products/bulk).

Uso rápido (más detalle en --help y en scripts/precios/README.md):
  python scripts/actualizar_precios.py scripts/precios/lista.xlsx             -> simulación + reporte
  python scripts/actualizar_precios.py scripts/precios/lista.xlsx --aplicar   -> aplica los cambios

Credenciales del panel (solo para --aplicar): variables de entorno
ELPAMPA_USER y ELPAMPA_PASSWORD. Nunca van en el código ni como argumento:
quedarían en el historial de la terminal y en la lista de procesos.

Por qué está hecho así:
- Por defecto SIMULA. La lista del mercado viene a mano y con errores de
  tipeo; un cero de más no puede llegar a la tienda sin que alguien lo mire.
- Nunca toca un producto que no matcheó con seguridad (umbral configurable),
  y frena los cambios de precio grandes (±40 % por defecto) salvo --forzar:
  la inflación pasa, un error de tipeo no.
- Los productos de la tienda se leen siempre del sitio (o de un JSON para
  trabajar sin conexión) y no de la base: así el script usa la misma API y
  las mismas validaciones que el panel.
"""

from __future__ import annotations

import argparse
import csv
import difflib
import email.utils
import getpass
import io
import json
import logging
import math
import numbers
import os
import random
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import urlsplit

try:
    import pandas as pd
    import requests
except ImportError as error:  # pragma: no cover - depende de la instalación
    print(
        f'Falta una librería de Python ({error.name}). Instalalas con:\n'
        '  python -m pip install -r scripts/requirements.txt',
        file=sys.stderr,
    )
    sys.exit(1)

VERSION = '1.0'

# --------------------------------------------------------------------------- #
# Rutas y constantes                                                          #
# --------------------------------------------------------------------------- #

SCRIPT_DIR = Path(__file__).resolve().parent
PRECIOS_DIR = SCRIPT_DIR / 'precios'
DIR_REPORTES = PRECIOS_DIR / 'reportes'
DIR_LOGS = PRECIOS_DIR / 'logs'
CONFIG_PROPIA = PRECIOS_DIR / 'margenes.json'
CONFIG_EJEMPLO = PRECIOS_DIR / 'margenes.example.json'

URL_DEFAULT = 'https://elpampa.vercel.app'
ENV_USUARIO = 'ELPAMPA_USER'
ENV_PASSWORD = 'ELPAMPA_PASSWORD'
ENV_URL = 'ELPAMPA_URL'

# Nombre de la cookie de sesión del panel (ADMIN_COOKIE_NAME en src/lib/auth.ts).
COOKIE_SESION = 'elpampa_admin'

# Deben coincidir con src/lib/product-categories.ts y src/lib/product-units.ts.
CATEGORIAS = ('Bolsones', 'Frutas', 'Verduras', 'Almacén', 'Ofertas')
UNIDADES_PESO = ('kg', 'g')
UNIDADES_CONTEO = ('unidad', 'atado', 'bandeja')
UNIDADES = UNIDADES_PESO + UNIDADES_CONTEO

# Tope del servidor (MAX_BULK_UPDATES en src/lib/validation.ts) y tope propio:
# lotes más chicos hacen que un lote rechazado afecte a menos productos.
MAX_LOTE_SERVIDOR = 500
MAX_LOTE = 200
# MAX_PRICE en src/lib/validation.ts: el servidor rechaza cualquier precio mayor.
PRECIO_MAXIMO = 10_000_000

# Cuántos ítems rechazados (400 con "index") se sacan de un lote antes de darlo
# por perdido. Uno o dos es normal (una oferta que cambió en el medio); muchos
# quiere decir que algo más grande está mal y conviene parar a mirar.
MAX_EXCLUSIONES_POR_LOTE = 10

# Fila máxima donde se busca el encabezado: las listas suelen traer el nombre del
# puesto, la fecha y alguna aclaración arriba de la tabla.
MAX_FILAS_ENCABEZADO = 30

# Códigos de salida (documentados en el README y en --help).
EXIT_OK = 0
EXIT_ERROR_INESPERADO = 1
EXIT_USO = 2
EXIT_LISTA = 3
EXIT_CONFIG = 4
EXIT_LOGIN = 5
EXIT_API = 6
EXIT_PARCIAL = 7
EXIT_INTERRUMPIDO = 130

# Estados de cada producto en el reporte.
ESTADO_ACTUALIZAR = 'actualizar'
ESTADO_SIN_CAMBIOS = 'sin cambios'
ESTADO_SIN_MATCH = 'sin match'
ESTADO_DUDOSO = 'match dudoso'
ESTADO_BLOQUEADO_LIMITE = 'bloqueado por límite'
ESTADO_BLOQUEADO_OFERTA = 'bloqueado por oferta'
ESTADO_REVISAR = 'revisar'
ESTADO_EXCLUIDO = 'excluido'
ESTADO_MARCAR_SIN_STOCK = 'marcar sin stock'
ESTADO_REACTIVAR = 'reactivar'
# Después de --aplicar:
ESTADO_ACTUALIZADO = 'actualizado'
ESTADO_MARCADO_SIN_STOCK = 'marcado sin stock'
ESTADO_REACTIVADO = 'reactivado'
ESTADO_RECHAZADO = 'rechazado por el servidor'
ESTADO_NO_ENCONTRADO = 'no encontrado en el sitio'
ESTADO_NO_ENVIADO = 'no enviado'
ESTADO_INTERRUMPIDO = 'interrumpido'

# Estado de simulación -> estado una vez aplicado.
ESTADO_APLICADO = {
    ESTADO_ACTUALIZAR: ESTADO_ACTUALIZADO,
    ESTADO_MARCAR_SIN_STOCK: ESTADO_MARCADO_SIN_STOCK,
    ESTADO_REACTIVAR: ESTADO_REACTIVADO,
}

log = logging.getLogger('actualizar_precios')


# --------------------------------------------------------------------------- #
# Errores                                                                     #
# --------------------------------------------------------------------------- #


class ErrorScript(Exception):
    """Error esperado: se muestra el mensaje (sin traceback) y se sale con su código."""

    codigo_salida = EXIT_ERROR_INESPERADO


class ErrorLista(ErrorScript):
    codigo_salida = EXIT_LISTA


class ErrorConfig(ErrorScript):
    codigo_salida = EXIT_CONFIG


class ErrorLogin(ErrorScript):
    codigo_salida = EXIT_LOGIN


class ErrorApi(ErrorScript):
    codigo_salida = EXIT_API


class ErrorLoteRechazado(ErrorScript):
    """El servidor rechazó un lote con 400. `indice` es el ítem culpable, si lo dijo."""

    codigo_salida = EXIT_PARCIAL

    def __init__(self, mensaje: str, indice: int | None = None):
        super().__init__(mensaje)
        self.indice = indice


class ErrorConversion(Exception):
    """No se puede pasar el precio de la lista a la unidad de venta de la tienda."""


class _ColumnasFaltantes(Exception):
    def __init__(self, roles: list[str], indicadas: dict[str, str] | None = None):
        super().__init__(', '.join(roles))
        self.roles = roles
        self.indicadas = indicadas or {}


# --------------------------------------------------------------------------- #
# Formato de números (estilo argentino)                                       #
# --------------------------------------------------------------------------- #


def formato_numero(valor: float, decimales: int = 2) -> str:
    """1388.889 -> "1.388,89"; 18.0 -> "18"."""
    redondeado = round(float(valor), decimales)
    if abs(redondeado - round(redondeado)) < 10 ** -(decimales + 1):
        texto = f'{int(round(redondeado)):,}'
    else:
        texto = f'{redondeado:,.{decimales}f}'.rstrip('0').rstrip('.')
    return texto.replace(',', '_').replace('.', ',').replace('_', '.')


def formato_pesos(valor: float | None) -> str:
    return '—' if valor is None else f'$ {formato_numero(valor)}'


def formato_pct(valor: float | None, signo: bool = True) -> str:
    if valor is None:
        return '—'
    texto = f'{valor:+.1f}' if signo else f'{valor:.1f}'
    return texto.replace('.', ',') + '%'


# --------------------------------------------------------------------------- #
# Normalización de nombres                                                    #
# --------------------------------------------------------------------------- #

_RE_NO_ALFANUM = re.compile(r'[^a-z0-9]+')

# Palabras que describen el envase, la calidad o la forma de venta y no el
# producto. Se sacan antes de comparar para que "TOMATE PERITA x 18 KG 1RA" y
# "Tomate perita" sean lo mismo.
PALABRAS_IGNORADAS = frozenset({
    # Envases y unidades
    'x', 'k', 'kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'g', 'gr', 'grs', 'gramo',
    'cc', 'ml', 'l', 'lt', 'litro', 'cajon', 'caja', 'cajita', 'bolsa', 'bolsita',
    'bulto', 'jaula', 'cesto', 'canasto', 'atado', 'bandeja', 'maple', 'docena',
    'unidad', 'unidades', 'u', 'un', 'unid', 'ud', 'uds', 'pieza', 'paquete',
    'malla', 'granel', 'suelto', 'suelta',
    # Calidad
    'primera', 'segunda', 'tercera', 'extra', 'especial', 'seleccion',
    'seleccionado', 'seleccionada', 'calidad', 'comercial', 'aprox',
    'aproximado', 'promedio', 'neto', 'peso',
    # Conectores
    'a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'los', 'o', 'por', 'y',
})


def sin_tildes(texto: str) -> str:
    descompuesto = unicodedata.normalize('NFKD', texto)
    return ''.join(caracter for caracter in descompuesto if not unicodedata.combining(caracter))


def normalizar_liviano(texto: Any) -> str:
    """Minúsculas, sin tildes ni signos, espacios simples. Conserva todas las palabras."""
    plano = sin_tildes(str(texto or '')).lower()
    return ' '.join(_RE_NO_ALFANUM.sub(' ', plano).split())


def _singular(palabra: str) -> str:
    """Plural -> singular aproximado. No tiene que ser perfecto: ambos lados pasan por acá."""
    if len(palabra) <= 3 or not palabra.endswith('s') or palabra.endswith('ss'):
        return palabra
    if palabra.endswith('ces'):
        return palabra[:-3] + 'z'  # nueces -> nuez
    if palabra.endswith(('ones', 'ores', 'ies')):
        return palabra[:-2]  # limones -> limon, coliflores -> coliflor, ajies -> aji
    return palabra[:-1]  # tomates -> tomate, zanahorias -> zanahoria


def normalizar_nombre(texto: Any) -> str:
    """
    Nombre comparable: sin tildes, en singular, sin números ni palabras de
    presentación ("x 18 kg", "cajón", "1ra", "primera").

    Si después de limpiar no queda nada (el nombre era solo "Kg"), se devuelve
    la versión liviana para no comparar cadenas vacías.
    """
    liviano = normalizar_liviano(texto)
    palabras = []
    for palabra in liviano.split():
        if any(caracter.isdigit() for caracter in palabra):
            continue  # "18", "x18kg", "1ra", "2da"
        singular = _singular(palabra)
        if palabra in PALABRAS_IGNORADAS or singular in PALABRAS_IGNORADAS:
            continue
        palabras.append(singular)
    return ' '.join(palabras) if palabras else liviano


def similitud(a: str, b: str, minimo: float = 0.0) -> float:
    """
    Parecido entre 0 y 1 (difflib). Se prueba también con las palabras ordenadas
    para que "rojo pimiento" y "pimiento rojo" den 1.

    `minimo` permite descartar rápido los pares que no pueden llegar: con cientos
    de productos por cientos de renglones son muchas comparaciones.
    """
    if a == b:
        return 1.0 if a else 0.0
    if not a or not b:
        return 0.0
    mejor = 0.0
    ordenado_a = ' '.join(sorted(a.split()))
    ordenado_b = ' '.join(sorted(b.split()))
    for x, y in ((a, b), (ordenado_a, ordenado_b)):
        piso = max(minimo, mejor)
        comparador = difflib.SequenceMatcher(None, x, y, autojunk=False)
        if comparador.real_quick_ratio() < piso or comparador.quick_ratio() < piso:
            continue
        mejor = max(mejor, comparador.ratio())
    return mejor


# --------------------------------------------------------------------------- #
# Números y presentaciones de la lista                                        #
# --------------------------------------------------------------------------- #

# "25.000", "1.250.000,50", "25 000" o un número simple ("18", "18,5", "1250.50").
_RE_NUMERO = re.compile(r'-?(?:\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)')


def parse_numero(valor: Any) -> float | None:
    """
    Número de una celda de la lista: acepta "$ 25.000", "25.000,50", "18,5",
    "25000.50" o un número de Excel. Devuelve None si no hay número.

    Convención argentina: el punto separa miles y la coma decimales. Una sola
    coma se toma como decimal ("18,5"); un solo punto seguido de exactamente
    tres dígitos se toma como miles ("25.000"). Si las dos aparecen, la última
    es la decimal. Si una lectura sale mal, el límite de cambio la frena igual.
    """
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, numbers.Real):
        numero = float(valor)
        return numero if math.isfinite(numero) else None
    texto = str(valor).replace(' ', ' ').strip()
    if not texto:
        return None
    encontrado = _RE_NUMERO.search(texto)
    if not encontrado:
        return None
    crudo = encontrado.group(0).replace(' ', '')
    negativo = crudo.startswith('-')
    crudo = crudo.lstrip('-')
    if '.' in crudo and ',' in crudo:
        if crudo.rfind(',') > crudo.rfind('.'):
            crudo = crudo.replace('.', '').replace(',', '.')
        else:
            crudo = crudo.replace(',', '')
    elif ',' in crudo:
        crudo = crudo.replace(',', '') if crudo.count(',') > 1 else crudo.replace(',', '.')
    elif '.' in crudo:
        partes = crudo.split('.')
        if len(partes) > 2 or len(partes[1]) == 3:
            crudo = crudo.replace('.', '')
    try:
        numero = float(crudo)
    except ValueError:
        return None
    return -numero if negativo else numero


_PESO = r'(?:kg|kgs|kilo|kilos|kilogramo|kilogramos|k|g|gr|grs|gramo|gramos)'
# "12 bandejas x 125 g", "10 x 1 kg": cantidad por peso de cada una.
_RE_N_POR_PESO = re.compile(
    r'(\d+)\s*(?:u|un|unid|unidades|bandejas?|paquetes?|bolsas?|bolsitas?|potes?|cajitas?)?\s*'
    r'(?:x|de)\s*(\d+(?:[.,]\d+)?)\s*(' + _PESO + r')\b'
)
_RE_KILOS = re.compile(r'(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilo|kilos|kilogramo|kilogramos|k)\b')
_RE_GRAMOS = re.compile(r'(\d+(?:[.,]\d+)?)\s*(?:g|gr|grs|gramo|gramos)\b')
_RE_UNIDADES = re.compile(
    r'(\d+)\s*(?:u|un|ud|uds|unid|unids|unidad|unidades|atados?|bandejas?|piezas?|plantas?|'
    r'paquetes?|cabezas?|potes?|bolsitas?|maples?)\b'
)
_RE_DOCENAS = re.compile(r'(\d+)\s*docenas?\b')
# Una sola unidad nombrada sin cantidad ("Atado", "Bandeja 125 g", "Unidad"): el
# precio es por esa unidad, aunque diga cuánto pesa.
_RE_UNA_UNIDAD = re.compile(r'\b(?:u|un|unid|unidad|atado|bandeja|maple|pieza|planta|cabeza|paquete)\b')
# La presentación dice que el precio ya es por kilo: "kg", "x kg", "por kilo", "el kilo", "1 kg".
_RE_POR_KG = re.compile(r'(?:x|por|el|al|precio)?\s*(?:1\s*)?(?:kg|kgs|kilo|kilos|kilogramo|kilogramos)')


@dataclass(frozen=True)
class Presentacion:
    kilos: float | None = None
    unidades: float | None = None
    por_kg: bool = False


def _a_float(texto: str) -> float:
    return float(texto.replace(',', '.'))


def parse_presentacion(texto: Any) -> Presentacion:
    """
    Lee cuántos kilos o unidades trae el bulto a partir de un texto libre:
    "Cajón 18 kg" -> 18 kg; "Bolsa x 50 u" -> 50 unidades; "x kg" -> precio por kilo.
    """
    # Como normalizar_liviano, pero conservando el separador decimal entre dígitos
    # ("18,5 kg" tiene que seguir siendo 18,5 y no "18 5").
    plano = sin_tildes(_texto_celda(texto)).lower()
    plano = re.sub(r'[^a-z0-9.,]+', ' ', plano)
    plano = re.sub(r'(?<!\d)[.,]|[.,](?!\d)', ' ', plano)
    plano = re.sub(r'(?<=\d)(?=[a-z])', ' ', plano)  # "18kg" -> "18 kg"
    plano = ' '.join(plano.split())
    if not plano:
        return Presentacion()

    if _RE_POR_KG.fullmatch(plano):
        return Presentacion(kilos=None, unidades=None, por_kg=True)

    kilos: float | None = None
    multiple = _RE_N_POR_PESO.search(plano)
    if multiple:
        cantidad, peso, unidad = int(multiple.group(1)), _a_float(multiple.group(2)), multiple.group(3)
        kilos = cantidad * (peso if unidad.startswith('k') else peso / 1000)
    else:
        en_kilos = _RE_KILOS.search(plano)
        if en_kilos:
            kilos = _a_float(en_kilos.group(1))
        else:
            en_gramos = _RE_GRAMOS.search(plano)
            if en_gramos:
                kilos = _a_float(en_gramos.group(1)) / 1000

    unidades: float | None = None
    docenas = _RE_DOCENAS.search(plano)
    unidades_texto = _RE_UNIDADES.search(plano)
    if docenas:
        unidades = int(docenas.group(1)) * 12
    elif 'media docena' in plano:
        unidades = 6
    elif unidades_texto:
        unidades = int(unidades_texto.group(1))
    elif re.search(r'\bdocena\b', plano):
        unidades = 12
    elif _RE_UNA_UNIDAD.search(plano):
        unidades = 1

    return Presentacion(
        kilos=kilos if kilos and kilos > 0 else None,
        unidades=unidades if unidades and unidades > 0 else None,
    )


# --------------------------------------------------------------------------- #
# Lectura de la lista del mercado                                             #
# --------------------------------------------------------------------------- #

# Sinónimos (normalizados) de cada columna. Primero se busca igualdad exacta y
# después "contiene la palabra".
SINONIMOS_COLUMNAS: dict[str, tuple[str, ...]] = {
    'producto': (
        'producto', 'productos', 'descripcion', 'articulo', 'articulos', 'detalle', 'nombre',
        'item', 'mercaderia', 'mercaderias', 'especie', 'concepto',
    ),
    'precio': (
        'precio', 'precios', 'precio mayorista', '$', 'importe', 'valor', 'precio unitario',
        'precio x bulto', 'precio por bulto', 'precio bulto', 'precio final', 'pcio', 'p mayorista',
        'precio lista', 'precio contado', 'costo',
    ),
    'unidad': (
        'unidad', 'presentacion', 'envase', 'bulto', 'empaque', 'um', 'u m', 'formato', 'medida',
        'tipo de bulto', 'unidad de venta',
    ),
    'kilos': (
        'kg por bulto', 'kg x bulto', 'kilos', 'kilos por bulto', 'kilos x bulto', 'kg', 'kgs',
        'peso', 'peso bulto', 'peso por bulto', 'kg bulto', 'kilos bulto', 'peso kg', 'peso neto',
    ),
    'unidades': (
        'unidades por bulto', 'unidades x bulto', 'u x bulto', 'u por bulto', 'unid x bulto',
        'unid por bulto', 'cantidad por bulto', 'cantidad x bulto', 'uxb',
    ),
}
# Orden para la búsqueda por "contiene": "precio x kg" tiene que ser precio y no
# kilos, y "kg por bulto" tiene que ser kilos y no presentación.
ORDEN_ROLES_CONTIENE = ('precio', 'producto', 'unidades', 'kilos', 'unidad')
NOMBRES_ROLES = {
    'producto': 'producto',
    'precio': 'precio',
    'unidad': 'presentación/unidad',
    'kilos': 'kilos por bulto',
    'unidades': 'unidades por bulto',
}
OPCIONES_ROLES = {
    'producto': '--col-producto',
    'precio': '--col-precio',
    'unidad': '--col-unidad',
    'kilos': '--col-kilos',
    'unidades': '--col-unidades',
}


def _norm_encabezado(texto: Any) -> str:
    plano = sin_tildes(_texto_celda(texto)).lower()
    return ' '.join(re.sub(r'[^a-z0-9$]+', ' ', plano).split())


def _contiene_frase(encabezado: str, frase: str) -> bool:
    if frase == '$':
        return '$' in encabezado
    return re.search(r'(?<![a-z0-9])' + re.escape(frase) + r'(?![a-z0-9])', encabezado) is not None


def detectar_columnas(encabezados: list[Any], indicadas: dict[str, str | None] | None = None) -> dict[str, int]:
    """
    Rol -> índice de columna. Las columnas indicadas a mano (CLI o JSON) mandan;
    el resto se autodetecta. Tira _ColumnasFaltantes si falta producto o precio,
    o si no aparece una columna indicada a mano.
    """
    normalizados = [_norm_encabezado(encabezado) for encabezado in encabezados]
    asignadas: dict[str, int] = {}
    usadas: set[int] = set()

    indicadas_limpias = {rol: nombre for rol, nombre in (indicadas or {}).items() if nombre}
    faltan_indicadas = []
    for rol, nombre in indicadas_limpias.items():
        objetivo = _norm_encabezado(nombre)
        indice = next((i for i, valor in enumerate(normalizados) if valor == objetivo and i not in usadas), None)
        if indice is None:
            faltan_indicadas.append(rol)
            continue
        asignadas[rol] = indice
        usadas.add(indice)
    if faltan_indicadas:
        raise _ColumnasFaltantes(faltan_indicadas, {rol: indicadas_limpias[rol] for rol in faltan_indicadas})

    for rol, sinonimos in SINONIMOS_COLUMNAS.items():
        if rol in asignadas:
            continue
        for indice, valor in enumerate(normalizados):
            if indice not in usadas and valor and valor in sinonimos:
                asignadas[rol] = indice
                usadas.add(indice)
                break

    for rol in ORDEN_ROLES_CONTIENE:
        if rol in asignadas:
            continue
        for indice, valor in enumerate(normalizados):
            if indice in usadas or not valor:
                continue
            if any(_contiene_frase(valor, sinonimo) for sinonimo in SINONIMOS_COLUMNAS[rol]):
                asignadas[rol] = indice
                usadas.add(indice)
                break

    faltan = [rol for rol in ('producto', 'precio') if rol not in asignadas]
    if faltan:
        raise _ColumnasFaltantes(faltan)
    return asignadas


@dataclass
class RenglonLista:
    fila: int  # número de fila como lo ve el dueño en Excel (o línea del CSV)
    nombre: str
    precio: float | None
    precio_texto: str = ''
    presentacion: str = ''
    kilos_bulto: float | None = None
    unidades_bulto: float | None = None
    por_kg: bool = False
    problema: str | None = None
    nombre_norm: str = field(init=False)
    nombre_liviano: str = field(init=False)

    def __post_init__(self):
        self.nombre_norm = normalizar_nombre(self.nombre)
        self.nombre_liviano = normalizar_liviano(self.nombre)


@dataclass
class ListaMercado:
    renglones: list[RenglonLista]
    columnas: dict[str, str]  # rol -> encabezado tal cual está en el archivo
    hoja: str | None
    fila_encabezado: int
    precio_por_kg_por_encabezado: bool


def _vacia(valor: Any) -> bool:
    if valor is None:
        return True
    if isinstance(valor, float) and math.isnan(valor):
        return True
    try:
        return bool(pd.isna(valor))
    except (TypeError, ValueError):
        return False


def _texto_celda(valor: Any) -> str:
    if _vacia(valor):
        return ''
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def _detectar_separador(texto: str) -> str:
    """
    Separador del CSV. csv.Sniffer se confunde con los títulos que traen las listas
    arriba de la tabla; acá gana el separador que deja más líneas con la misma
    cantidad de campos (y más de uno).
    """
    lineas = [linea for linea in texto.splitlines()[:60] if linea.strip()]
    mejor, mejor_puntaje = ';', -1
    for separador in (';', ',', '\t', '|'):
        cantidades = [len(fila) for fila in csv.reader(lineas, delimiter=separador)]
        cantidades = [cantidad for cantidad in cantidades if cantidad > 1]
        if not cantidades:
            continue
        moda = max(set(cantidades), key=cantidades.count)
        puntaje = cantidades.count(moda)
        if puntaje > mejor_puntaje:
            mejor, mejor_puntaje = separador, puntaje
    return mejor


def _leer_csv(ruta: Path) -> list[list[Any]]:
    datos = ruta.read_bytes()
    # Excel en Windows guarda los CSV en cp1252; los demás, en UTF-8.
    for codificacion in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            texto = datos.decode(codificacion)
            break
        except UnicodeDecodeError:
            continue
    separador = _detectar_separador(texto)
    log.debug('CSV leído con separador %r.', separador)
    return [list(fila) for fila in csv.reader(io.StringIO(texto), delimiter=separador)]


def _leer_hojas_excel(ruta: Path, hoja: str | None) -> list[tuple[str, list[list[Any]]]]:
    try:
        libro = pd.ExcelFile(ruta)
    except PermissionError as error:
        raise ErrorLista(f'No pude abrir "{ruta.name}": ¿está abierto en Excel? Cerralo y probá de nuevo.') from error
    except ImportError as error:
        raise ErrorLista(
            f'Para leer "{ruta.name}" falta una librería ({error}). '
            'Lo más fácil: abrilo en Excel y guardalo como .xlsx o .csv.'
        ) from error
    except Exception as error:  # openpyxl tira varios tipos distintos
        raise ErrorLista(f'No pude abrir el Excel "{ruta.name}": {error}') from error

    with libro:
        nombres = [str(nombre) for nombre in libro.sheet_names]
        if hoja:
            elegida = next((nombre for nombre in nombres if nombre.strip().lower() == hoja.strip().lower()), None)
            if elegida is None:
                raise ErrorLista(f'El Excel no tiene una hoja "{hoja}". Hojas que tiene: {", ".join(nombres)}.')
            nombres = [elegida]
        hojas = []
        for nombre in nombres:
            tabla = libro.parse(nombre, header=None, dtype=object)
            filas = [[None if _vacia(valor) else valor for valor in fila] for fila in tabla.values.tolist()]
            hojas.append((nombre, filas))
        return hojas


def _buscar_encabezado(filas: list[list[Any]], indicadas: dict[str, str | None]) -> tuple[int, dict[str, int]]:
    ultimo_error: _ColumnasFaltantes | None = None
    for indice, fila in enumerate(filas[:MAX_FILAS_ENCABEZADO]):
        if sum(1 for celda in fila if _texto_celda(celda)) < 2:
            continue
        try:
            return indice, detectar_columnas(fila, indicadas)
        except _ColumnasFaltantes as error:
            # Si el dueño indicó una columna a mano, el error útil es "no está la que
            # indicaste", no "falta el precio" de alguna fila de títulos.
            if ultimo_error is None or (error.indicadas and not ultimo_error.indicadas):
                ultimo_error = error
    raise ultimo_error or _ColumnasFaltantes(['producto', 'precio'])


def _fila_mas_parecida_a_encabezado(filas: list[list[Any]]) -> tuple[int, list[str]]:
    mejor_indice, mejor = 0, []
    for indice, fila in enumerate(filas[:MAX_FILAS_ENCABEZADO]):
        textos = [_texto_celda(celda) for celda in fila if _texto_celda(celda)]
        # Un encabezado es texto, no números: se descuentan las celdas numéricas.
        puntaje = sum(1 for texto in textos if parse_numero(texto) is None)
        if puntaje > len(mejor):
            mejor_indice, mejor = indice, textos
    return mejor_indice, mejor


def _mensaje_columnas_faltantes(error: _ColumnasFaltantes, filas: list[list[Any]], donde: str) -> str:
    indice, columnas = _fila_mas_parecida_a_encabezado(filas)
    hay = ', '.join(f'"{columna}"' for columna in columnas) if columnas else '(no encontré encabezados)'
    if error.indicadas:
        detalle = '; '.join(f'{OPCIONES_ROLES[rol]} "{nombre}"' for rol, nombre in error.indicadas.items())
        return (
            f'No encontré en {donde} la columna que indicaste ({detalle}). '
            f'Columnas que encontré (fila {indice + 1}): {hay}. Revisá que el nombre sea igual al del archivo.'
        )
    faltan = ' y '.join(NOMBRES_ROLES[rol] for rol in error.roles)
    opciones = ' / '.join(f'{OPCIONES_ROLES[rol]} "Nombre de la columna"' for rol in error.roles)
    return (
        f'No encontré la columna de {faltan} en {donde}. '
        f'Columnas que encontré (fila {indice + 1}): {hay}. '
        f'Indicá cuál es con {opciones}, o en "columnas" del JSON de configuración.'
    )


def leer_lista(
    ruta: Path,
    hoja: str | None = None,
    columnas: dict[str, str | None] | None = None,
    ignorar: Iterable[str] = (),
) -> ListaMercado:
    """Lee la lista del mercado (xlsx/xlsm/xls/ods o csv/txt) y la deja lista para cruzar."""
    ruta = Path(ruta)
    if not ruta.exists():
        raise ErrorLista(f'No encontré el archivo "{ruta}". Revisá el nombre y la carpeta.')
    if ruta.is_dir():
        raise ErrorLista(f'"{ruta}" es una carpeta: pasá el archivo de la lista (Excel o CSV).')

    extension = ruta.suffix.lower()
    indicadas = columnas or {}
    if extension in ('.csv', '.txt'):
        if hoja:
            log.warning('--hoja no aplica a un CSV: se ignora.')
        try:
            hojas = [(None, _leer_csv(ruta))]
        except PermissionError as error:
            raise ErrorLista(f'No pude abrir "{ruta.name}": ¿está abierto en Excel? Cerralo y probá de nuevo.') from error
        except OSError as error:
            raise ErrorLista(f'No pude leer "{ruta}": {error}') from error
    elif extension in ('.xlsx', '.xlsm', '.xls', '.ods'):
        hojas = _leer_hojas_excel(ruta, hoja)
    else:
        raise ErrorLista(f'No sé leer archivos "{extension or "sin extensión"}". Usá Excel (.xlsx) o CSV.')

    primer_error: tuple[_ColumnasFaltantes, list[list[Any]], str] | None = None
    for nombre_hoja, filas in hojas:
        try:
            indice_encabezado, mapeo = _buscar_encabezado(filas, indicadas)
        except _ColumnasFaltantes as error:
            donde = f'la hoja "{nombre_hoja}"' if nombre_hoja else f'"{ruta.name}"'
            primer_error = primer_error or (error, filas, donde)
            continue
        return _armar_lista(filas, indice_encabezado, mapeo, nombre_hoja, ignorar)

    assert primer_error is not None
    error, filas, donde = primer_error
    raise ErrorLista(_mensaje_columnas_faltantes(error, filas, donde))


def _armar_lista(
    filas: list[list[Any]],
    indice_encabezado: int,
    mapeo: dict[str, int],
    hoja: str | None,
    ignorar: Iterable[str],
) -> ListaMercado:
    encabezado = filas[indice_encabezado]
    columnas = {rol: _texto_celda(encabezado[indice]) for rol, indice in mapeo.items()}
    encabezado_precio = _norm_encabezado(encabezado[mapeo['precio']])
    precio_por_kg = any(palabra in ('kg', 'kgs', 'kilo', 'kilos') for palabra in encabezado_precio.split())
    nombre_encabezado = _norm_encabezado(encabezado[mapeo['producto']])
    ignorados = {normalizar_nombre(nombre) for nombre in ignorar}

    def celda(fila: list[Any], rol: str) -> Any:
        indice = mapeo.get(rol)
        return fila[indice] if indice is not None and indice < len(fila) else None

    renglones: list[RenglonLista] = []
    for indice, fila in enumerate(filas[indice_encabezado + 1:], start=indice_encabezado + 2):
        nombre = _texto_celda(celda(fila, 'producto'))
        if not nombre or not normalizar_liviano(nombre):
            continue
        if _norm_encabezado(nombre) == nombre_encabezado:
            continue  # encabezado repetido (listas que lo repiten en cada página)
        if normalizar_nombre(nombre) in ignorados:
            log.debug('Fila %s: "%s" está en "ignorar_en_lista".', indice, nombre)
            continue

        precio_crudo = celda(fila, 'precio')
        precio = parse_numero(precio_crudo)
        presentacion = _texto_celda(celda(fila, 'unidad'))
        otras = [celda(fila, rol) for rol in ('precio', 'unidad', 'kilos', 'unidades')]
        if precio is None and all(not _texto_celda(valor) for valor in otras):
            log.debug('Fila %s: "%s" no tiene precio ni datos; se toma como título de sección.', indice, nombre)
            continue

        kilos = parse_numero(celda(fila, 'kilos'))
        unidades = parse_numero(celda(fila, 'unidades'))
        leida = parse_presentacion(presentacion) if presentacion else Presentacion()
        if not leida.kilos and not leida.unidades and not leida.por_kg:
            # Algunas listas meten la presentación en el nombre: "TOMATE x 18 KG".
            leida = parse_presentacion(nombre)

        problema = None
        if precio is None:
            problema = f'precio ilegible ("{_texto_celda(precio_crudo)}")'
        elif precio <= 0:
            problema = 'el precio es cero o negativo'

        renglones.append(RenglonLista(
            fila=indice,
            nombre=nombre,
            precio=precio,
            precio_texto=_texto_celda(precio_crudo),
            presentacion=presentacion,
            kilos_bulto=kilos if kilos and kilos > 0 else leida.kilos,
            unidades_bulto=unidades if unidades and unidades > 0 else leida.unidades,
            por_kg=precio_por_kg or leida.por_kg,
            problema=problema,
        ))

    return ListaMercado(
        renglones=renglones,
        columnas=columnas,
        hoja=hoja,
        fila_encabezado=indice_encabezado + 1,
        precio_por_kg_por_encabezado=precio_por_kg,
    )


# --------------------------------------------------------------------------- #
# Productos de la tienda                                                      #
# --------------------------------------------------------------------------- #


@dataclass
class ProductoTienda:
    id: int
    nombre: str
    precio: float
    unidad: str
    categoria: str
    disponible: bool = True
    precio_oferta: float | None = None
    oferta_vence: datetime | None = None


def _parse_fecha(valor: Any) -> datetime | None:
    if not valor:
        return None
    try:
        fecha = datetime.fromisoformat(str(valor).replace('Z', '+00:00'))
    except ValueError:
        return None
    return fecha if fecha.tzinfo else fecha.replace(tzinfo=timezone.utc)


def productos_desde_datos(datos: Any, origen: str) -> list[ProductoTienda]:
    """Convierte la respuesta de GET /api/products (o el JSON offline) en productos."""
    if isinstance(datos, dict):
        datos = datos.get('products', datos.get('productos'))
    if not isinstance(datos, list):
        raise ErrorApi(f'{origen} no trae una lista de productos.')

    productos = []
    for posicion, item in enumerate(datos, start=1):
        if not isinstance(item, dict):
            log.warning('%s: el elemento %s no es un producto; se saltea.', origen, posicion)
            continue
        identificador = item.get('id')
        nombre = item.get('name')
        precio = item.get('price')
        unidad = item.get('unit')
        if (
            not isinstance(identificador, int) or isinstance(identificador, bool)
            or not isinstance(nombre, str) or not nombre.strip()
            or not isinstance(precio, numbers.Real) or isinstance(precio, bool)
        ):
            log.warning('%s: el elemento %s no tiene id, name y price válidos; se saltea.', origen, posicion)
            continue
        if unidad not in UNIDADES:
            log.warning('%s: "%s" tiene una unidad desconocida (%r); se saltea.', origen, nombre, unidad)
            continue
        oferta = item.get('offerPrice')
        productos.append(ProductoTienda(
            id=identificador,
            nombre=nombre.strip(),
            precio=float(precio),
            unidad=unidad,
            categoria=item.get('category') if item.get('category') in CATEGORIAS else 'Almacén',
            disponible=item.get('available') is not False,
            precio_oferta=float(oferta) if isinstance(oferta, numbers.Real) and not isinstance(oferta, bool) else None,
            oferta_vence=_parse_fecha(item.get('offerEndsAt')),
        ))
    if not productos and datos:
        raise ErrorApi(f'{origen} no trae ningún producto válido.')
    return productos


def cargar_productos_json(ruta: Path) -> list[ProductoTienda]:
    ruta = Path(ruta)
    try:
        datos = json.loads(ruta.read_text(encoding='utf-8-sig'))
    except FileNotFoundError as error:
        raise ErrorConfig(f'No encontré el archivo de productos "{ruta}".') from error
    except json.JSONDecodeError as error:
        raise ErrorConfig(f'"{ruta.name}" no es un JSON válido (línea {error.lineno}: {error.msg}).') from error
    except OSError as error:
        raise ErrorConfig(f'No pude leer "{ruta}": {error}') from error
    try:
        return productos_desde_datos(datos, f'"{ruta.name}"')
    except ErrorApi as error:
        raise ErrorConfig(str(error)) from error


def oferta_sigue_corriendo(producto: ProductoTienda, ahora: datetime) -> bool:
    """Misma regla que assertOfferConsistency del servidor para un cambio de precio solo."""
    if producto.precio_oferta is None:
        return False
    return producto.oferta_vence is None or producto.oferta_vence > ahora


# --------------------------------------------------------------------------- #
# Configuración                                                               #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Redondeo:
    """Redondeo comercial por tramos: (hasta, múltiplo); el último tramo no tiene tope."""

    modo: str = 'arriba'  # 'arriba' | 'cercano' | 'abajo'
    tramos: tuple[tuple[float | None, float], ...] = ((None, 50.0),)

    def multiplo_para(self, valor: float) -> float:
        for hasta, multiplo in self.tramos:
            if hasta is None or valor <= hasta:
                return multiplo
        return self.tramos[-1][1]

    def aplicar(self, valor: float) -> float:
        multiplo = self.multiplo_para(valor)
        if multiplo <= 0:
            return round(valor, 2)
        cociente = valor / multiplo
        # El margen de 1e-9 evita que 2100 / 50 = 42.000000001 suba a 43.
        if self.modo == 'arriba':
            veces = math.ceil(cociente - 1e-9)
        elif self.modo == 'abajo':
            veces = math.floor(cociente + 1e-9)
        else:
            veces = math.floor(cociente + 0.5)  # round() de Python redondea al par
        return round(veces * multiplo, 2)

    def describir(self) -> str:
        partes = []
        for hasta, multiplo in self.tramos:
            texto = f'a ${formato_numero(multiplo)}'
            partes.append(f'{texto} hasta ${formato_numero(hasta)}' if hasta is not None else texto)
        return f'{self.modo}: ' + ', '.join(partes)


MODOS_REDONDEO = ('arriba', 'cercano', 'abajo')
MODOS_PRECIO_POR = ('auto', 'bulto', 'kg')


@dataclass
class Configuracion:
    url: str | None = None
    margenes_pct: dict[str, float] = field(default_factory=lambda: {
        'Frutas': 45.0, 'Verduras': 50.0, 'Almacén': 30.0, 'Bolsones': 35.0, 'Ofertas': 25.0,
    })
    margen_default_pct: float = 40.0
    margenes_producto_pct: dict[str, float] = field(default_factory=dict)  # nombre normalizado
    redondeo: Redondeo = field(default_factory=lambda: Redondeo('arriba', ((1000.0, 10.0), (10000.0, 50.0), (None, 100.0))))
    limite_cambio_pct: float = 40.0
    umbral_match: float = 0.85
    umbral_dudoso: float = 0.6
    alias: dict[str, list[str]] = field(default_factory=dict)
    kg_por_unidad: dict[str, float] = field(default_factory=dict)  # nombre normalizado
    columnas: dict[str, str | None] = field(default_factory=dict)
    precio_por: str = 'auto'
    categorias_sin_stock: tuple[str, ...] = ('Frutas', 'Verduras')
    categorias_excluidas: tuple[str, ...] = ()
    productos_excluidos: frozenset[str] = frozenset()  # nombres normalizados
    ignorar_en_lista: tuple[str, ...] = ()
    tamano_lote: int = MAX_LOTE

    def margen_para(self, producto: ProductoTienda) -> float:
        propio = self.margenes_producto_pct.get(normalizar_nombre(producto.nombre))
        if propio is not None:
            return propio
        return self.margenes_pct.get(producto.categoria, self.margen_default_pct)


CLAVES_CONFIG = {
    'url', 'margenes_pct', 'margenes_por_producto_pct', 'redondeo', 'limite_cambio_pct', 'umbral_match',
    'umbral_dudoso', 'alias', 'kg_por_unidad', 'columnas', 'precio_por', 'categorias_sin_stock',
    'categorias_excluidas', 'productos_excluidos', 'ignorar_en_lista', 'tamano_lote',
}


def _categoria_canonica(nombre: Any) -> str | None:
    clave = normalizar_liviano(nombre)
    return next((categoria for categoria in CATEGORIAS if normalizar_liviano(categoria) == clave), None)


def _numero_config(valor: Any, clave: str, minimo: float | None = None, maximo: float | None = None) -> float:
    if isinstance(valor, bool) or not isinstance(valor, numbers.Real):
        raise ErrorConfig(f'"{clave}" tiene que ser un número (vino {json.dumps(valor, ensure_ascii=False)}).')
    numero = float(valor)
    if (minimo is not None and numero < minimo) or (maximo is not None and numero > maximo):
        rango = f'entre {formato_numero(minimo or 0)} y {formato_numero(maximo)}' if maximo is not None else f'mayor o igual a {formato_numero(minimo or 0)}'
        raise ErrorConfig(f'"{clave}" tiene que ser {rango} (vino {formato_numero(numero)}).')
    return numero


def _umbral_config(valor: Any, clave: str) -> float:
    numero = _numero_config(valor, clave, 0, 100)
    # Se acepta 0.85 o 85 (lo segundo es más natural para quien no programa).
    return numero / 100 if numero > 1 else numero


def _lista_textos(valor: Any, clave: str) -> list[str]:
    if not isinstance(valor, list) or not all(isinstance(item, str) for item in valor):
        raise ErrorConfig(f'"{clave}" tiene que ser una lista de textos, por ejemplo ["Frutas", "Verduras"].')
    return [item.strip() for item in valor if item.strip()]


def _categorias_config(valor: Any, clave: str) -> tuple[str, ...]:
    resultado = []
    for nombre in _lista_textos(valor, clave):
        categoria = _categoria_canonica(nombre)
        if categoria is None:
            raise ErrorConfig(f'"{clave}": "{nombre}" no es una categoría de la tienda ({", ".join(CATEGORIAS)}).')
        resultado.append(categoria)
    return tuple(resultado)


def _redondeo_config(valor: Any) -> Redondeo:
    if isinstance(valor, numbers.Real) and not isinstance(valor, bool):
        return Redondeo('arriba', ((None, _numero_config(valor, 'redondeo', 0)),))
    if not isinstance(valor, dict):
        raise ErrorConfig('"redondeo" tiene que ser un número (el múltiplo) o un objeto con "modo" y "tramos".')
    modo = valor.get('modo', 'arriba')
    if modo not in MODOS_REDONDEO:
        raise ErrorConfig(f'"redondeo.modo" tiene que ser {", ".join(MODOS_REDONDEO)} (vino "{modo}").')
    if 'tramos' not in valor:
        return Redondeo(modo, ((None, _numero_config(valor.get('multiplo', 50), 'redondeo.multiplo', 0)),))
    tramos_crudos = valor['tramos']
    if not isinstance(tramos_crudos, list) or not tramos_crudos:
        raise ErrorConfig('"redondeo.tramos" tiene que ser una lista como [{"hasta": 1000, "multiplo": 10}, {"multiplo": 50}].')
    tramos: list[tuple[float | None, float]] = []
    anterior = -math.inf
    for posicion, tramo in enumerate(tramos_crudos, start=1):
        if not isinstance(tramo, dict) or 'multiplo' not in tramo:
            raise ErrorConfig(f'"redondeo.tramos": el tramo {posicion} tiene que tener "multiplo".')
        multiplo = _numero_config(tramo['multiplo'], f'redondeo.tramos[{posicion}].multiplo', 0)
        hasta = tramo.get('hasta')
        if hasta is not None:
            hasta = _numero_config(hasta, f'redondeo.tramos[{posicion}].hasta', 0)
            if hasta <= anterior:
                raise ErrorConfig('"redondeo.tramos" tiene que ir de menor a mayor "hasta".')
            anterior = hasta
        elif posicion != len(tramos_crudos):
            raise ErrorConfig('En "redondeo.tramos", solo el último tramo puede no tener "hasta".')
        tramos.append((hasta, multiplo))
    return Redondeo(modo, tuple(tramos))


def _dict_por_producto(valor: Any, clave: str, minimo: float, maximo: float | None = None) -> dict[str, float]:
    if not isinstance(valor, dict):
        raise ErrorConfig(f'"{clave}" tiene que ser un objeto {{"Nombre del producto": número}}.')
    return {
        normalizar_nombre(nombre): _numero_config(numero, f'{clave}.{nombre}', minimo, maximo)
        for nombre, numero in valor.items()
        if not str(nombre).startswith('_')
    }


def configuracion_desde_dict(datos: dict[str, Any], origen: str = 'la configuración') -> Configuracion:
    """Valida el JSON de configuración. Las claves que empiezan con "_" son comentarios."""
    if not isinstance(datos, dict):
        raise ErrorConfig(f'{origen} tiene que ser un objeto JSON ({{ ... }}).')
    config = Configuracion()
    desconocidas = sorted(clave for clave in datos if clave not in CLAVES_CONFIG and not clave.startswith('_'))
    if desconocidas:
        log.warning(
            '%s: no conozco %s (¿error de tipeo?). Se ignora. Claves válidas: %s.',
            origen, ', '.join(f'"{clave}"' for clave in desconocidas), ', '.join(sorted(CLAVES_CONFIG)),
        )

    if datos.get('url') is not None:
        if not isinstance(datos['url'], str):
            raise ErrorConfig('"url" tiene que ser un texto, por ejemplo "https://elpampa.vercel.app".')
        config.url = datos['url'].strip() or None

    if 'margenes_pct' in datos:
        margenes = datos['margenes_pct']
        if not isinstance(margenes, dict):
            raise ErrorConfig('"margenes_pct" tiene que ser un objeto como {"Frutas": 45, "default": 40}.')
        config.margenes_pct = {}
        for nombre, valor in margenes.items():
            if str(nombre).startswith('_'):
                continue
            numero = _numero_config(valor, f'margenes_pct.{nombre}', 0, 1000)
            if normalizar_liviano(nombre) == 'default':
                config.margen_default_pct = numero
                continue
            categoria = _categoria_canonica(nombre)
            if categoria is None:
                raise ErrorConfig(
                    f'"margenes_pct": "{nombre}" no es una categoría de la tienda '
                    f'({", ".join(CATEGORIAS)}) ni "default".'
                )
            config.margenes_pct[categoria] = numero

    if 'margenes_por_producto_pct' in datos:
        config.margenes_producto_pct = _dict_por_producto(datos['margenes_por_producto_pct'], 'margenes_por_producto_pct', 0, 1000)
    if 'kg_por_unidad' in datos:
        config.kg_por_unidad = _dict_por_producto(datos['kg_por_unidad'], 'kg_por_unidad', 0.001, 100)
    if 'redondeo' in datos:
        config.redondeo = _redondeo_config(datos['redondeo'])
    if 'limite_cambio_pct' in datos:
        config.limite_cambio_pct = _numero_config(datos['limite_cambio_pct'], 'limite_cambio_pct', 1, 1000)
    if 'umbral_match' in datos:
        config.umbral_match = _umbral_config(datos['umbral_match'], 'umbral_match')
    if 'umbral_dudoso' in datos:
        config.umbral_dudoso = _umbral_config(datos['umbral_dudoso'], 'umbral_dudoso')

    if 'alias' in datos:
        alias = datos['alias']
        if not isinstance(alias, dict):
            raise ErrorConfig('"alias" tiene que ser un objeto {"nombre en la lista": "nombre en la tienda"}.')
        config.alias = {}
        for clave, destino in alias.items():
            if str(clave).startswith('_'):
                continue
            destinos = [destino] if isinstance(destino, str) else destino
            if not isinstance(destinos, list) or not destinos or not all(isinstance(d, str) and d.strip() for d in destinos):
                raise ErrorConfig(f'"alias.{clave}" tiene que ser el nombre de un producto (o una lista de nombres).')
            config.alias[clave] = [d.strip() for d in destinos]

    if 'columnas' in datos:
        columnas = datos['columnas']
        if not isinstance(columnas, dict):
            raise ErrorConfig('"columnas" tiene que ser un objeto como {"producto": "Artículo", "precio": "Precio"}.')
        config.columnas = {}
        for rol, nombre in columnas.items():
            if str(rol).startswith('_'):
                continue
            if rol not in SINONIMOS_COLUMNAS:
                raise ErrorConfig(f'"columnas": "{rol}" no es válida. Usá {", ".join(SINONIMOS_COLUMNAS)}.')
            if nombre is not None and not isinstance(nombre, str):
                raise ErrorConfig(f'"columnas.{rol}" tiene que ser el nombre de la columna o null.')
            config.columnas[rol] = nombre.strip() if isinstance(nombre, str) and nombre.strip() else None

    if 'precio_por' in datos:
        if datos['precio_por'] not in MODOS_PRECIO_POR:
            raise ErrorConfig(f'"precio_por" tiene que ser {", ".join(MODOS_PRECIO_POR)}.')
        config.precio_por = datos['precio_por']
    if 'categorias_sin_stock' in datos:
        config.categorias_sin_stock = _categorias_config(datos['categorias_sin_stock'], 'categorias_sin_stock')
    if 'categorias_excluidas' in datos:
        config.categorias_excluidas = _categorias_config(datos['categorias_excluidas'], 'categorias_excluidas')
    if 'productos_excluidos' in datos:
        config.productos_excluidos = frozenset(
            normalizar_nombre(nombre) for nombre in _lista_textos(datos['productos_excluidos'], 'productos_excluidos')
        )
    if 'ignorar_en_lista' in datos:
        config.ignorar_en_lista = tuple(_lista_textos(datos['ignorar_en_lista'], 'ignorar_en_lista'))
    if 'tamano_lote' in datos:
        config.tamano_lote = int(_numero_config(datos['tamano_lote'], 'tamano_lote', 1, MAX_LOTE))

    validar_umbrales(config)
    return config


def validar_umbrales(config: Configuracion) -> None:
    if not 0 < config.umbral_match <= 1:
        raise ErrorConfig('El umbral de coincidencia tiene que estar entre 0 y 1 (o entre 1 y 100 en %).')
    if config.umbral_dudoso > config.umbral_match:
        raise ErrorConfig('"umbral_dudoso" no puede ser mayor que el umbral de coincidencia.')


def cargar_configuracion(ruta: Path) -> Configuracion:
    ruta = Path(ruta)
    try:
        texto = ruta.read_text(encoding='utf-8-sig')
    except FileNotFoundError as error:
        raise ErrorConfig(f'No encontré el archivo de configuración "{ruta}".') from error
    except OSError as error:
        raise ErrorConfig(f'No pude leer "{ruta}": {error}') from error
    try:
        datos = json.loads(texto)
    except json.JSONDecodeError as error:
        raise ErrorConfig(
            f'"{ruta.name}" no es un JSON válido (línea {error.lineno}, columna {error.colno}: {error.msg}). '
            'Revisá comas y comillas.'
        ) from error
    return configuracion_desde_dict(datos, f'"{ruta.name}"')


# --------------------------------------------------------------------------- #
# Cruce por nombre                                                            #
# --------------------------------------------------------------------------- #

PRIORIDAD_ALIAS_LITERAL = 4  # el alias coincide con el nombre completo ("tomate perita 1ra")
PRIORIDAD_ALIAS = 3  # el alias coincide con el nombre normalizado ("tomate perita")
PRIORIDAD_EXACTO = 2
PRIORIDAD_PARECIDO = 1
METODOS = {
    PRIORIDAD_ALIAS_LITERAL: 'alias',
    PRIORIDAD_ALIAS: 'alias',
    PRIORIDAD_EXACTO: 'exacto',
    PRIORIDAD_PARECIDO: 'parecido',
}


@dataclass(frozen=True)
class Candidato:
    producto_id: int
    renglon: int  # índice en la lista de renglones
    puntaje: float
    prioridad: int

    @property
    def metodo(self) -> str:
        return METODOS[self.prioridad]


@dataclass
class ResultadoCruce:
    asignados: dict[int, Candidato]  # producto_id -> candidato
    dudosos: dict[int, tuple[Candidato, str]]  # producto_id -> (mejor candidato, motivo)
    empates: dict[int, list[Candidato]]
    sin_usar: dict[int, str]  # índice de renglón -> motivo
    avisos: list[str]


def cruzar(
    productos: list[ProductoTienda],
    renglones: list[RenglonLista],
    alias: dict[str, list[str]] | None = None,
    umbral: float = 0.85,
    umbral_dudoso: float = 0.6,
) -> ResultadoCruce:
    """
    Asigna a cada producto como mucho un renglón de la lista, y cada renglón a
    como mucho un producto.

    Que sea uno a uno es a propósito: si la lista solo trae "Zapallo", el
    producto "Zapallito" (87 % parecido) NO se lleva el precio del zapallo. Se
    reparte de mayor a menor coincidencia y el que se queda sin renglón queda
    como "match dudoso" para que lo mire el dueño.
    """
    avisos: list[str] = []
    por_id = {producto.id: producto for producto in productos}
    por_nombre: dict[str, list[int]] = {}
    for producto in productos:
        por_nombre.setdefault(normalizar_nombre(producto.nombre), []).append(producto.id)

    alias_literal: dict[str, set[int]] = {}
    alias_normal: dict[str, set[int]] = {}
    for clave, destinos in (alias or {}).items():
        ids: set[int] = set()
        for destino in destinos:
            encontrados = por_nombre.get(normalizar_nombre(destino))
            if not encontrados:
                avisos.append(f'El alias "{clave}" apunta a "{destino}", que no está en la tienda: se ignora.')
                continue
            ids.update(encontrados)
        if ids:
            alias_literal.setdefault(normalizar_liviano(clave), set()).update(ids)
            alias_normal.setdefault(normalizar_nombre(clave), set()).update(ids)

    nombres_productos = [(producto.id, normalizar_nombre(producto.nombre)) for producto in productos]
    candidatos: list[Candidato] = []
    for indice, renglon in enumerate(renglones):
        ids_alias = alias_literal.get(renglon.nombre_liviano)
        prioridad = PRIORIDAD_ALIAS_LITERAL
        if not ids_alias:
            ids_alias = alias_normal.get(renglon.nombre_norm)
            prioridad = PRIORIDAD_ALIAS
        if ids_alias:
            # Un renglón con alias es de ese producto y de ningún otro: lo dijo el dueño.
            candidatos.extend(Candidato(pid, indice, 1.0, prioridad) for pid in sorted(ids_alias))
            continue
        for producto_id, nombre in nombres_productos:
            if nombre == renglon.nombre_norm:
                candidatos.append(Candidato(producto_id, indice, 1.0, PRIORIDAD_EXACTO))
                continue
            puntaje = similitud(nombre, renglon.nombre_norm, minimo=umbral_dudoso)
            if puntaje >= umbral_dudoso:
                candidatos.append(Candidato(producto_id, indice, puntaje, PRIORIDAD_PARECIDO))

    candidatos.sort(key=lambda c: (-c.puntaje, -c.prioridad, c.renglon, c.producto_id))

    asignados: dict[int, Candidato] = {}
    renglon_de: dict[int, int] = {}  # renglón -> producto
    for candidato in candidatos:
        if candidato.puntaje < umbral:
            break
        if candidato.producto_id in asignados or candidato.renglon in renglon_de:
            continue
        asignados[candidato.producto_id] = candidato
        renglon_de[candidato.renglon] = candidato.producto_id

    por_producto: dict[int, list[Candidato]] = {}
    por_renglon: dict[int, list[Candidato]] = {}
    for candidato in candidatos:  # siguen ordenados de mejor a peor
        por_producto.setdefault(candidato.producto_id, []).append(candidato)
        por_renglon.setdefault(candidato.renglon, []).append(candidato)

    empates: dict[int, list[Candidato]] = {}
    for producto_id, elegido in asignados.items():
        iguales = [
            otro for otro in por_producto[producto_id]
            if otro.renglon != elegido.renglon and otro.puntaje == elegido.puntaje and otro.prioridad == elegido.prioridad
        ]
        if iguales:
            empates[producto_id] = iguales

    dudosos: dict[int, tuple[Candidato, str]] = {}
    for producto in productos:
        if producto.id in asignados or producto.id not in por_producto:
            continue
        mejor = por_producto[producto.id][0]
        renglon = renglones[mejor.renglon]
        if mejor.renglon in renglon_de:
            otro = por_id[renglon_de[mejor.renglon]]
            motivo = f'"{renglon.nombre}" (fila {renglon.fila}) ya se usó para "{otro.nombre}"'
        else:
            motivo = (
                f'"{renglon.nombre}" (fila {renglon.fila}) se parece un {round(mejor.puntaje * 100)}%, '
                f'por debajo del mínimo ({round(umbral * 100)}%)'
            )
        dudosos[producto.id] = (mejor, motivo)

    sin_usar: dict[int, str] = {}
    for indice, renglon in enumerate(renglones):
        if indice in renglon_de:
            continue
        motivo = 'no se parece a ningún producto de la tienda'
        if indice in por_renglon:
            mejor = por_renglon[indice][0]
            producto = por_id[mejor.producto_id]
            if mejor.puntaje >= umbral and mejor.producto_id in asignados:
                otra_fila = renglones[asignados[mejor.producto_id].renglon].fila
                motivo = f'coincide con "{producto.nombre}", pero ese producto ya tomó la fila {otra_fila}'
            else:
                motivo = (
                    f'se parece a "{producto.nombre}" ({round(mejor.puntaje * 100)}%), '
                    f'por debajo del mínimo ({round(umbral * 100)}%)'
                )
        if renglon.problema:
            motivo = f'{renglon.problema}; {motivo}'
        sin_usar[indice] = motivo

    return ResultadoCruce(asignados, dudosos, empates, sin_usar, avisos)


# --------------------------------------------------------------------------- #
# Cálculo del precio                                                          #
# --------------------------------------------------------------------------- #


def convertir_costo(
    renglon: RenglonLista,
    unidad: str,
    kg_por_unidad: float | None = None,
    precio_por: str = 'auto',
) -> tuple[float, str]:
    """
    Costo por unidad de venta de la tienda (kg, g, unidad, atado o bandeja) a
    partir del precio de la lista, y una explicación de la cuenta para el reporte.

    Tira ErrorConversion cuando no hay forma honesta de convertirlo (por ejemplo,
    la lista lo vende por kilo y la tienda por unidad, sin saber cuánto pesa cada una).
    """
    precio = renglon.precio
    if precio is None or precio <= 0:
        raise ErrorConversion(renglon.problema or 'el renglón no tiene precio')
    presentacion = renglon.presentacion or renglon.nombre

    def desde_kilo(costo_kg: float, explicacion: str) -> tuple[float, str]:
        if unidad == 'kg':
            return costo_kg, explicacion
        if unidad == 'g':
            return costo_kg / 1000, f'{explicacion} = {formato_pesos(costo_kg / 1000)} por g'
        if not kg_por_unidad:
            raise ErrorConversion(
                f'la lista lo vende por kilo y en la tienda va por {unidad}. Para convertirlo, cargá '
                f'cuánto pesa cada {unidad} en "kg_por_unidad" del JSON.'
            )
        costo = costo_kg * kg_por_unidad
        return costo, (
            f'{explicacion} × {formato_numero(kg_por_unidad, 3)} kg por {unidad} = '
            f'{formato_pesos(costo)} por {unidad}'
        )

    por_kg = precio_por == 'kg' or (precio_por == 'auto' and renglon.por_kg)
    if por_kg:
        return desde_kilo(precio, f'{formato_pesos(precio)} por kg')

    if unidad in UNIDADES_PESO:
        if renglon.kilos_bulto:
            costo_kg = precio / renglon.kilos_bulto
            return desde_kilo(costo_kg, (
                f'{presentacion}: {formato_pesos(precio)} ÷ {formato_numero(renglon.kilos_bulto, 3)} kg = '
                f'{formato_pesos(costo_kg)} por kg'
            ))
        if renglon.unidades_bulto:
            raise ErrorConversion(
                f'la lista lo vende por unidades ("{presentacion}") y en la tienda va por {unidad}: no se puede convertir'
            )
        if precio_por == 'bulto':
            raise ErrorConversion(
                f'no encontré cuántos kilos trae el bulto ("{presentacion}"). Agregá una columna de kilos '
                'o escribilo en la presentación ("Cajón 18 kg")'
            )
        costo, explicacion = desde_kilo(precio, f'{formato_pesos(precio)} por kg')
        return costo, f'{explicacion} (la lista no dice kilos por bulto: se tomó como precio por kg)'

    # Unidad de conteo: unidad, atado, bandeja.
    if renglon.unidades_bulto:
        costo = precio / renglon.unidades_bulto
        return costo, (
            f'{presentacion}: {formato_pesos(precio)} ÷ {formato_numero(renglon.unidades_bulto)} = '
            f'{formato_pesos(costo)} por {unidad}'
        )
    if renglon.kilos_bulto:
        costo_kg = precio / renglon.kilos_bulto
        return desde_kilo(costo_kg, (
            f'{presentacion}: {formato_pesos(precio)} ÷ {formato_numero(renglon.kilos_bulto, 3)} kg = '
            f'{formato_pesos(costo_kg)} por kg'
        ))
    if precio_por == 'bulto':
        raise ErrorConversion(
            f'no encontré cuántas unidades trae el bulto ("{presentacion}"). Agregá una columna '
            '"unidades por bulto" o escribilo en la presentación ("Caja x 12 u")'
        )
    return precio, f'{formato_pesos(precio)} por {unidad} (la lista no dice cuántas trae el bulto: se tomó como precio por {unidad})'


def precio_venta(costo: float, margen_pct: float, unidad: str, redondeo: Redondeo) -> float:
    """
    costo × (1 + margen) con redondeo comercial. Para lo que va por gramo el
    redondeo se hace sobre el precio del kilo y después se divide: redondear
    "$ 9,87 el gramo" a $ 50 no tendría sentido.
    """
    factor = 1 + margen_pct / 100
    if unidad == 'g':
        return round(redondeo.aplicar(costo * 1000 * factor) / 1000, 2)
    return redondeo.aplicar(costo * factor)


def cambio_pct(actual: float, nuevo: float) -> float | None:
    if actual <= 0:
        return None
    return (nuevo - actual) / actual * 100


def excede_limite(actual: float, nuevo: float, limite_pct: float) -> bool:
    """Un precio actual de 0 se toma como fuera de límite: no hay contra qué comparar."""
    cambio = cambio_pct(actual, nuevo)
    return cambio is None or abs(cambio) > limite_pct + 1e-9


def armar_lotes(actualizaciones: list[dict[str, Any]], tamano: int = MAX_LOTE) -> list[list[dict[str, Any]]]:
    if not 1 <= tamano <= MAX_LOTE_SERVIDOR:
        raise ValueError(f'El tamaño de lote tiene que estar entre 1 y {MAX_LOTE_SERVIDOR}.')
    return [actualizaciones[inicio:inicio + tamano] for inicio in range(0, len(actualizaciones), tamano)]


# --------------------------------------------------------------------------- #
# Plan de cambios                                                             #
# --------------------------------------------------------------------------- #


@dataclass
class Opciones:
    forzar: bool = False
    marcar_sin_stock: bool = False
    reactivar: bool = False


@dataclass
class FilaPlan:
    producto: ProductoTienda
    estado: str
    detalle: str = ''
    renglon: RenglonLista | None = None
    candidato: Candidato | None = None
    costo: float | None = None
    margen_pct: float | None = None
    precio_nuevo: float | None = None
    cambio_pct: float | None = None
    cambio_stock: str = ''
    actualizacion: dict[str, Any] | None = None


@dataclass
class Plan:
    filas: list[FilaPlan]
    dudosos: list[dict[str, Any]]
    sin_usar: list[dict[str, Any]]
    avisos: list[str]

    @property
    def actualizaciones(self) -> list[dict[str, Any]]:
        return [fila.actualizacion for fila in self.filas if fila.actualizacion]

    def contar(self) -> dict[str, int]:
        conteo: dict[str, int] = {}
        for fila in self.filas:
            conteo[fila.estado] = conteo.get(fila.estado, 0) + 1
        return conteo


def _precio_json(valor: float) -> float | int:
    return int(valor) if float(valor).is_integer() else round(valor, 2)


def armar_plan(
    productos: list[ProductoTienda],
    lista: ListaMercado,
    config: Configuracion,
    opciones: Opciones,
    ahora: datetime | None = None,
) -> Plan:
    ahora = ahora or datetime.now(timezone.utc)
    renglones = lista.renglones
    cruce = cruzar(productos, renglones, config.alias, config.umbral_match, config.umbral_dudoso)
    filas: list[FilaPlan] = []

    for producto in sorted(productos, key=lambda p: normalizar_liviano(p.nombre)):
        candidato = cruce.asignados.get(producto.id)
        renglon = renglones[candidato.renglon] if candidato else None
        fila = FilaPlan(producto=producto, estado=ESTADO_SIN_MATCH, renglon=renglon, candidato=candidato)
        filas.append(fila)

        if producto.categoria in config.categorias_excluidas or normalizar_nombre(producto.nombre) in config.productos_excluidos:
            fila.estado = ESTADO_EXCLUIDO
            fila.detalle = 'Excluido en la configuración: el script no lo toca.'
            continue

        if candidato is None:
            dudoso = cruce.dudosos.get(producto.id)
            if dudoso:
                fila.estado = ESTADO_DUDOSO
                fila.renglon = renglones[dudoso[0].renglon]
                fila.candidato = dudoso[0]
                fila.detalle = (
                    f'Posible renglón: {dudoso[1]}. No se toca. Si es el mismo producto, agregá en "alias": '
                    f'"{normalizar_liviano(fila.renglon.nombre)}": "{producto.nombre}".'
                )
                continue
            fila.detalle = 'No aparece en la lista.'
            # Solo lo que NO aparece en absoluto: un "match dudoso" probablemente
            # sí está en la lista con otro nombre, y no hay que sacarlo de venta.
            if opciones.marcar_sin_stock and producto.disponible and producto.categoria in config.categorias_sin_stock:
                fila.estado = ESTADO_MARCAR_SIN_STOCK
                fila.cambio_stock = 'pasa a sin stock'
                fila.detalle = 'No aparece en la lista: pasa a sin stock.'
                fila.actualizacion = {'id': producto.id, 'available': False}
            continue

        notas = []
        if candidato.metodo != 'exacto':
            notas.append(f'Match por {candidato.metodo}' + (f' ({round(candidato.puntaje * 100)}%)' if candidato.metodo == 'parecido' else '') + '.')
        empatados = cruce.empates.get(producto.id)
        if empatados:
            otros = ', '.join(f'fila {renglones[c.renglon].fila} "{renglones[c.renglon].nombre}"' for c in empatados)
            notas.append(f'Había otro renglón igual de parecido ({otros}); se usó el primero de la lista.')

        try:
            costo, explicacion = convertir_costo(
                renglon,
                producto.unidad,
                config.kg_por_unidad.get(normalizar_nombre(producto.nombre)),
                config.precio_por,
            )
        except ErrorConversion as error:
            fila.estado = ESTADO_REVISAR
            fila.detalle = ' '.join([f'No se pudo calcular: {str(error).rstrip(".")}.'] + notas)
            continue

        margen = config.margen_para(producto)
        nuevo = precio_venta(costo, margen, producto.unidad, config.redondeo)
        fila.costo = round(costo, 4 if producto.unidad == 'g' else 2)
        fila.margen_pct = margen
        fila.precio_nuevo = nuevo
        fila.cambio_pct = cambio_pct(producto.precio, nuevo)
        detalle = [explicacion + '.'] + notas

        if nuevo <= 0 or nuevo > PRECIO_MAXIMO:
            fila.estado = ESTADO_REVISAR
            fila.detalle = ' '.join([f'El precio calculado ({formato_pesos(nuevo)}) está fuera de rango.'] + detalle)
            continue
        if abs(nuevo - producto.precio) < 0.005:
            fila.estado = ESTADO_SIN_CAMBIOS
        elif excede_limite(producto.precio, nuevo, config.limite_cambio_pct) and not opciones.forzar:
            fila.estado = ESTADO_BLOQUEADO_LIMITE
            if fila.cambio_pct is None:
                detalle.insert(0, 'El precio actual es $ 0: no hay contra qué comparar. Si está bien, usá --forzar.')
            else:
                verbo = 'Sube' if fila.cambio_pct > 0 else 'Baja'
                detalle.insert(0, (
                    f'{verbo} {formato_pct(abs(fila.cambio_pct), signo=False)} (el límite es ±'
                    f'{formato_numero(config.limite_cambio_pct, 1)}%). Si está bien, corré con --forzar.'
                ))
        elif oferta_sigue_corriendo(producto, ahora) and producto.precio_oferta >= nuevo:
            # El servidor rechazaría todo el lote: la oferta tiene que quedar por debajo del precio normal.
            fila.estado = ESTADO_BLOQUEADO_OFERTA
            detalle.insert(0, (
                f'Tiene una oferta vigente de {formato_pesos(producto.precio_oferta)} y el precio nuevo '
                f'no quedaría por encima. Cambiá o sacá la oferta en el panel.'
            ))
        else:
            fila.estado = ESTADO_ACTUALIZAR
            fila.actualizacion = {'id': producto.id, 'price': _precio_json(nuevo)}
            if fila.cambio_pct is not None and excede_limite(producto.precio, nuevo, config.limite_cambio_pct):
                detalle.insert(0, 'Supera el límite de cambio, pero se aplicó --forzar.')

        if opciones.reactivar and not producto.disponible and fila.estado in (ESTADO_ACTUALIZAR, ESTADO_SIN_CAMBIOS):
            fila.cambio_stock = 'se reactiva'
            fila.actualizacion = {**(fila.actualizacion or {'id': producto.id}), 'available': True}
            if fila.estado == ESTADO_SIN_CAMBIOS:
                fila.estado = ESTADO_REACTIVAR
            detalle.append('Volvió a la lista: se reactiva.')
        fila.detalle = ' '.join(detalle)

    dudosos = []
    for fila in filas:
        if fila.estado != ESTADO_DUDOSO:
            continue
        dudosos.append({
            'ID': fila.producto.id,
            'Producto': fila.producto.nombre,
            'Categoría': fila.producto.categoria,
            'Renglón parecido': fila.renglon.nombre,
            'Fila': fila.renglon.fila,
            'Coincidencia %': round(fila.candidato.puntaje * 100),
            'Motivo': cruce.dudosos[fila.producto.id][1],
            'Alias sugerido': f'"{normalizar_liviano(fila.renglon.nombre)}": "{fila.producto.nombre}"',
        })

    sin_usar = [
        {
            'Fila': renglones[indice].fila,
            'Renglón de la lista': renglones[indice].nombre,
            'Precio en la lista': renglones[indice].precio,
            'Presentación': renglones[indice].presentacion,
            'Motivo': motivo,
        }
        for indice, motivo in sorted(cruce.sin_usar.items())
    ]

    return Plan(filas=filas, dudosos=dudosos, sin_usar=sin_usar, avisos=cruce.avisos)


# --------------------------------------------------------------------------- #
# Cliente HTTP                                                                #
# --------------------------------------------------------------------------- #


# Únicos hosts a los que se les permite http:// (pruebas en la propia compu).
HOSTS_LOCALES = ('localhost', '127.0.0.1', '::1')


def normalizar_url(url: str) -> str:
    url = (url or '').strip()
    partes = urlsplit(url)
    if partes.scheme not in ('http', 'https') or not partes.netloc:
        raise ErrorConfig(f'La dirección del sitio tiene que empezar con https:// (vino "{url}").')
    return f'{partes.scheme}://{partes.netloc}{partes.path.rstrip("/")}'


def _mensaje_servidor(respuesta: requests.Response) -> str:
    try:
        datos = respuesta.json()
    except ValueError:
        tipo = respuesta.headers.get('Content-Type', '')
        if 'html' in tipo:
            return 'la respuesta es una página web, no la API'
        return (respuesta.text or '').strip()[:200]
    if isinstance(datos, dict) and isinstance(datos.get('error'), str):
        return datos['error']
    return ''


def _segundos_retry_after(respuesta: requests.Response) -> float | None:
    valor = respuesta.headers.get('Retry-After')
    if not valor:
        return None
    valor = valor.strip()
    if valor.isdigit():
        return float(valor)
    try:
        fecha = email.utils.parsedate_to_datetime(valor)
    except (TypeError, ValueError):
        return None
    if fecha.tzinfo is None:
        fecha = fecha.replace(tzinfo=timezone.utc)
    return max(0.0, (fecha - datetime.now(timezone.utc)).total_seconds())


class ClienteApi:
    """
    Habla con la API del sitio usando una requests.Session: el login devuelve la
    cookie httpOnly "elpampa_admin" (Path=/api/gestion) y la sesión la guarda y
    la manda sola en cada pedido al panel. No se manda header Origin: el
    middleware solo frena pedidos con un Origin ajeno (los de otro sitio web).
    """

    def __init__(
        self,
        base_url: str,
        *,
        sesion: requests.Session | None = None,
        timeout: tuple[float, float] = (10, 60),
        reintentos: int = 4,
        espera_base: float = 1.0,
        espera_maxima: float = 120.0,
        dormir: Callable[[float], None] = time.sleep,
    ):
        self.base_url = normalizar_url(base_url)
        self.sesion = sesion or requests.Session()
        self.sesion.headers.update({
            'User-Agent': f'elpampa-actualizar-precios/{VERSION}',
            'Accept': 'application/json',
        })
        self.timeout = timeout
        self.reintentos = max(0, reintentos)
        self.espera_base = espera_base
        self.espera_maxima = espera_maxima
        self.dormir = dormir

    def _espera(self, intento: int) -> float:
        # Backoff exponencial con un poco de azar para no pegarle al servidor todos a la vez.
        return min(30.0, self.espera_base * 2 ** (intento - 1)) + random.uniform(0, self.espera_base / 2)

    def _pedir(self, metodo: str, ruta: str, *, cuerpo: Any = None, descripcion: str, reintentar_429: bool = True) -> requests.Response:
        """
        Reintenta errores de red, 5xx y 429 (respetando Retry-After). Un 4xx
        distinto de 429 se devuelve enseguida: reintentarlo daría lo mismo.

        Reintentar un POST al bulk es seguro: pone valores absolutos (no suma),
        así que mandarlo dos veces deja los mismos precios.
        """
        url = self.base_url + ruta
        intentos = self.reintentos + 1
        for intento in range(1, intentos + 1):
            try:
                respuesta = self.sesion.request(metodo, url, json=cuerpo, timeout=self.timeout, allow_redirects=False)
            except requests.exceptions.SSLError as error:
                raise ErrorApi(f'{descripcion}: error de certificado con {self.base_url} ({error}).') from error
            except (requests.ConnectionError, requests.Timeout) as error:
                problema = 'el sitio tardó demasiado en responder' if isinstance(error, requests.Timeout) else 'no se pudo conectar'
                if intento == intentos:
                    raise ErrorApi(
                        f'{descripcion}: {problema} después de {intentos} intentos. '
                        f'¿Hay internet? ¿El sitio ({self.base_url}) está andando?'
                    ) from error
                espera = self._espera(intento)
                log.warning('%s: %s. Reintento %s de %s en %.0f s...', descripcion, problema, intento, self.reintentos, espera)
                self.dormir(espera)
                continue
            except requests.RequestException as error:
                raise ErrorApi(f'{descripcion}: {error}') from error

            if 300 <= respuesta.status_code < 400:
                destino = respuesta.headers.get('Location', '?')
                # No se sigue la redirección a ciegas: el login lleva la contraseña en el cuerpo.
                raise ErrorApi(
                    f'{descripcion}: el sitio redirige a {destino}. Usá directamente esa dirección en --url '
                    f'(o en {ENV_URL}).'
                )

            reintentable = respuesta.status_code >= 500 or (respuesta.status_code == 429 and reintentar_429)
            if not reintentable or intento == intentos:
                return respuesta

            espera = _segundos_retry_after(respuesta)
            if espera is None:
                espera = self._espera(intento)
            elif espera > self.espera_maxima:
                raise ErrorApi(
                    f'{descripcion}: el sitio pide esperar {math.ceil(espera / 60)} minutos '
                    f'(HTTP {respuesta.status_code}). Probá de nuevo más tarde.'
                )
            log.warning(
                '%s: el sitio respondió %s (%s). Reintento %s de %s en %.0f s...',
                descripcion, respuesta.status_code, _mensaje_servidor(respuesta) or 'sin detalle',
                intento, self.reintentos, espera,
            )
            self.dormir(espera)
        raise AssertionError('no debería llegar acá')  # pragma: no cover

    def _error_http(self, respuesta: requests.Response, descripcion: str) -> ErrorApi:
        mensaje = _mensaje_servidor(respuesta)
        codigo = respuesta.status_code
        if codigo == 404:
            return ErrorApi(f'{descripcion}: no encontré la API en {self.base_url} (404). ¿La dirección es la del sitio?')
        if codigo == 429:
            return ErrorApi(f'{descripcion}: el sitio sigue pidiendo que esperemos (429). Probá en unos minutos.')
        if codigo >= 500:
            return ErrorApi(f'{descripcion}: el sitio tuvo un error ({codigo}{": " + mensaje if mensaje else ""}). Probá en un rato.')
        return ErrorApi(f'{descripcion}: respuesta inesperada ({codigo}{": " + mensaje if mensaje else ""}).')

    def iniciar_sesion(self, usuario: str, password: str) -> None:
        descripcion = 'Inicio de sesión'
        # Segunda barrera: nunca mandar la contraseña por http:// a otro host.
        partes = urlsplit(self.base_url)
        if partes.scheme != 'https' and partes.hostname not in HOSTS_LOCALES:
            raise ErrorLogin('No mando la contraseña por http://: usá la dirección https:// del sitio.')
        # Un 429 en el login NO se reintenta: es el freno contra fuerza bruta y
        # cada intento extra alarga el bloqueo.
        respuesta = self._pedir(
            'POST', '/api/gestion/login', cuerpo={'username': usuario, 'password': password},
            descripcion=descripcion, reintentar_429=False,
        )
        if respuesta.status_code == 200:
            cookies = [cookie for cookie in self.sesion.cookies if cookie.name == COOKIE_SESION]
            if not cookies:
                raise ErrorLogin(
                    'El login respondió bien pero no llegó la cookie de sesión. Si usás http://, probá con https://.'
                )
            if partes.scheme == 'http':
                # La cookie viene con Secure, y requests no la devuelve por http://
                # (el navegador sí, porque trata a localhost como seguro). Solo
                # pasa con los hosts locales: a otro host por http no se llega.
                for cookie in cookies:
                    cookie.secure = False
            log.info('Sesión iniciada en %s.', self.base_url)
            return
        if respuesta.status_code == 401:
            raise ErrorLogin(f'Usuario o contraseña incorrectos. Revisá {ENV_USUARIO} y {ENV_PASSWORD}.')
        if respuesta.status_code == 429:
            espera = _segundos_retry_after(respuesta)
            cuanto = f'unos {max(1, math.ceil(espera / 60))} minutos' if espera else 'unos minutos'
            raise ErrorLogin(
                f'El sitio bloqueó el login por demasiados intentos fallidos. Esperá {cuanto} y revisá la contraseña.'
            )
        raise self._error_http(respuesta, descripcion)

    def obtener_productos(self) -> list[ProductoTienda]:
        descripcion = 'Descarga de productos'
        respuesta = self._pedir('GET', '/api/products', descripcion=descripcion)
        if respuesta.status_code != 200:
            raise self._error_http(respuesta, descripcion)
        try:
            datos = respuesta.json()
        except ValueError as error:
            raise ErrorApi(f'{descripcion}: la respuesta no es JSON. ¿La dirección ({self.base_url}) es la del sitio?') from error
        return productos_desde_datos(datos, 'La respuesta de /api/products')

    def enviar_lote(self, actualizaciones: list[dict[str, Any]]) -> dict[str, Any]:
        descripcion = 'Envío de cambios'
        respuesta = self._pedir('POST', '/api/gestion/products/bulk', cuerpo={'updates': actualizaciones}, descripcion=descripcion)
        if respuesta.status_code == 200:
            try:
                datos = respuesta.json()
            except ValueError as error:
                raise ErrorApi(f'{descripcion}: la respuesta no es JSON.') from error
            if not isinstance(datos, dict) or not isinstance(datos.get('updated'), int) or not isinstance(datos.get('notFound', []), list):
                raise ErrorApi(f'{descripcion}: respuesta inesperada del sitio ({str(datos)[:200]}).')
            return datos
        if respuesta.status_code == 401:
            raise ErrorLogin('El sitio no reconoce la sesión (401): se venció o no se mandó la cookie. Volvé a correr el script.')
        if respuesta.status_code in (400, 413):
            indice = None
            try:
                datos = respuesta.json()
                if isinstance(datos, dict) and isinstance(datos.get('index'), int) and not isinstance(datos.get('index'), bool):
                    indice = datos['index']
            except ValueError:
                pass
            raise ErrorLoteRechazado(_mensaje_servidor(respuesta) or f'HTTP {respuesta.status_code}', indice)
        raise self._error_http(respuesta, descripcion)


# --------------------------------------------------------------------------- #
# Aplicación de cambios                                                       #
# --------------------------------------------------------------------------- #


@dataclass
class ResultadoAplicacion:
    aplicados: int = 0
    rechazados: int = 0
    no_encontrados: int = 0
    no_enviados: int = 0
    lotes: int = 0
    error_fatal: ErrorScript | None = None
    interrumpido: bool = False


def aplicar_cambios(cliente: ClienteApi, plan: Plan, tamano_lote: int = MAX_LOTE) -> ResultadoAplicacion:
    """
    Manda las actualizaciones en lotes y deja en cada fila del plan qué pasó.

    Si el servidor rechaza un ítem puntual (400 con "index"), se saca ese ítem y
    se reenvía el resto del lote: un producto con un problema no frena a los
    otros 199. Un error de red o de sesión corta todo lo que falta.
    """
    resultado = ResultadoAplicacion()
    filas_por_id = {fila.producto.id: fila for fila in plan.filas if fila.actualizacion}
    lotes = armar_lotes(plan.actualizaciones, tamano_lote)
    resultado.lotes = len(lotes)

    def marcar(items: Iterable[dict[str, Any]], estado: str, detalle: str | None = None) -> None:
        for item in items:
            fila = filas_por_id[item['id']]
            fila.estado = estado
            if detalle:
                fila.detalle = f'{detalle} {fila.detalle}'.strip()

    for numero, lote in enumerate(lotes, start=1):
        pendientes = list(lote)
        exclusiones = 0
        try:
            while pendientes:
                try:
                    respuesta = cliente.enviar_lote(pendientes)
                except ErrorLoteRechazado as error:
                    if error.indice is not None and 0 <= error.indice < len(pendientes) and exclusiones < MAX_EXCLUSIONES_POR_LOTE:
                        item = pendientes.pop(error.indice)
                        exclusiones += 1
                        resultado.rechazados += 1
                        marcar([item], ESTADO_RECHAZADO, f'El sitio lo rechazó: {error}.')
                        log.warning('Lote %s: el sitio rechazó "%s" (%s). Se reenvía el resto.',
                                    numero, filas_por_id[item['id']].producto.nombre, error)
                        continue
                    resultado.rechazados += len(pendientes)
                    marcar(pendientes, ESTADO_RECHAZADO, f'El sitio rechazó el lote: {error}.')
                    log.error('Lote %s: el sitio rechazó el lote completo (%s).', numero, error)
                    break
                no_encontrados = {int(i) for i in respuesta.get('notFound', []) if isinstance(i, int)}
                for item in pendientes:
                    fila = filas_por_id[item['id']]
                    if item['id'] in no_encontrados:
                        resultado.no_encontrados += 1
                        marcar([item], ESTADO_NO_ENCONTRADO, 'El producto ya no existe en el sitio (¿lo borraron recién?).')
                    else:
                        resultado.aplicados += 1
                        fila.estado = ESTADO_APLICADO.get(fila.estado, fila.estado)
                log.info('Lote %s de %s: %s cambios guardados.', numero, len(lotes), respuesta.get('updated'))
                break
        except (ErrorApi, ErrorLogin) as error:
            restantes = pendientes + [item for siguiente in lotes[numero:] for item in siguiente]
            resultado.no_enviados += len(restantes)
            marcar(restantes, ESTADO_NO_ENVIADO, 'No se pudo enviar.')
            resultado.error_fatal = error
            return resultado
        except KeyboardInterrupt:
            restantes = pendientes + [item for siguiente in lotes[numero:] for item in siguiente]
            resultado.no_enviados += len(restantes)
            marcar(restantes, ESTADO_INTERRUMPIDO, 'Se cortó a mano: el lote en curso puede haberse guardado o no.')
            resultado.interrumpido = True
            return resultado
    return resultado


# --------------------------------------------------------------------------- #
# Reportes                                                                    #
# --------------------------------------------------------------------------- #

COLORES_ESTADO = {
    ESTADO_ACTUALIZAR: 'D9EAD3', ESTADO_ACTUALIZADO: 'B6D7A8',
    ESTADO_REACTIVAR: 'D9EAD3', ESTADO_REACTIVADO: 'B6D7A8',
    ESTADO_DUDOSO: 'FFF2CC', ESTADO_REVISAR: 'FFF2CC',
    ESTADO_BLOQUEADO_LIMITE: 'F4CCCC', ESTADO_BLOQUEADO_OFERTA: 'F4CCCC',
    ESTADO_RECHAZADO: 'EA9999', ESTADO_NO_ENVIADO: 'EA9999', ESTADO_INTERRUMPIDO: 'EA9999',
    ESTADO_MARCAR_SIN_STOCK: 'FCE5CD', ESTADO_MARCADO_SIN_STOCK: 'F9CB9C',
}
ORDEN_ESTADOS = [
    ESTADO_RECHAZADO, ESTADO_NO_ENVIADO, ESTADO_INTERRUMPIDO, ESTADO_NO_ENCONTRADO,
    ESTADO_ACTUALIZAR, ESTADO_ACTUALIZADO, ESTADO_REACTIVAR, ESTADO_REACTIVADO,
    ESTADO_BLOQUEADO_LIMITE, ESTADO_BLOQUEADO_OFERTA, ESTADO_DUDOSO, ESTADO_REVISAR,
    ESTADO_MARCAR_SIN_STOCK, ESTADO_MARCADO_SIN_STOCK, ESTADO_SIN_MATCH, ESTADO_SIN_CAMBIOS, ESTADO_EXCLUIDO,
]


def filas_reporte(plan: Plan) -> list[dict[str, Any]]:
    orden = {estado: posicion for posicion, estado in enumerate(ORDEN_ESTADOS)}
    filas = sorted(plan.filas, key=lambda f: (orden.get(f.estado, 99), normalizar_liviano(f.producto.nombre)))
    return [
        {
            'ID': fila.producto.id,
            'Producto': fila.producto.nombre,
            'Categoría': fila.producto.categoria,
            'Unidad': fila.producto.unidad,
            'Precio actual': fila.producto.precio,
            'Costo': fila.costo,
            'Margen %': fila.margen_pct,
            'Precio nuevo': fila.precio_nuevo,
            'Cambio %': round(fila.cambio_pct, 1) if fila.cambio_pct is not None else None,
            'Estado': fila.estado,
            'Disponible': 'Sí' if fila.producto.disponible else 'No',
            'Cambio de stock': fila.cambio_stock,
            'Detalle': fila.detalle,
            'Renglón de la lista': fila.renglon.nombre if fila.renglon else '',
            'Fila': fila.renglon.fila if fila.renglon else None,
            'Coincidencia %': round(fila.candidato.puntaje * 100) if fila.candidato else None,
            'Precio en la lista': fila.renglon.precio if fila.renglon else None,
            'Presentación': fila.renglon.presentacion if fila.renglon else '',
        }
        for fila in filas
    ]


# Un texto que empieza con alguno de estos caracteres Excel/LibreOffice lo toma
# como fórmula. El reporte copia textos que vienen de afuera (la lista del
# mayorista, nombres del sitio): una celda "=HYPERLINK(...)" se ejecutaría al
# abrir el reporte.
_PREFIJOS_FORMULA = ('=', '+', '-', '@', '\t', '\r')


def _texto_seguro(valor: Any) -> Any:
    """Que Excel no interprete como fórmula un texto que vino de la lista o del sitio."""
    if isinstance(valor, str) and valor.startswith(_PREFIJOS_FORMULA):
        return "'" + valor
    return valor


def _sin_formulas(tabla: pd.DataFrame) -> pd.DataFrame:
    copia = tabla.copy()
    for columna in copia.columns:
        # En pandas 3 las columnas de texto son dtype "str", ya no object.
        if copia[columna].dtype == object or pd.api.types.is_string_dtype(copia[columna]):
            copia[columna] = copia[columna].map(_texto_seguro)
    return copia


def _formatear_hoja(hoja, tabla: pd.DataFrame, colorear_estado: bool = False) -> None:
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    hoja.freeze_panes = 'A2'
    # El reporte no usa fórmulas propias: cualquier celda que haya quedado como
    # fórmula se fuerza a texto (se muestra, pero Excel no la evalúa).
    for fila in hoja.iter_rows():
        for celda in fila:
            if celda.data_type == 'f':
                celda.data_type = 's'
    for celda in hoja[1]:
        celda.font = Font(bold=True)
    for posicion, columna in enumerate(tabla.columns, start=1):
        valores = [str(columna)] + [str(valor) for valor in tabla[columna].tolist() if not _vacia(valor)]
        hoja.column_dimensions[get_column_letter(posicion)].width = min(70, max(len(valor) for valor in valores) + 2)
        if columna in ('Precio actual', 'Costo', 'Precio nuevo', 'Precio en la lista'):
            for celda in hoja[get_column_letter(posicion)][1:]:
                celda.number_format = '#,##0.00'
        if columna == 'Detalle':
            for celda in hoja[get_column_letter(posicion)][1:]:
                celda.alignment = Alignment(wrap_text=False)
    if tabla.shape[0] > 0:
        hoja.auto_filter.ref = hoja.dimensions
    if colorear_estado and 'Estado' in tabla.columns:
        letra = get_column_letter(list(tabla.columns).index('Estado') + 1)
        for celda in hoja[letra][1:]:
            color = COLORES_ESTADO.get(celda.value)
            if color:
                celda.fill = PatternFill('solid', start_color=color, end_color=color)


def escribir_reportes(
    plan: Plan,
    directorio: Path,
    formato: str,
    sello: str,
    modo: str,
    resumen: list[tuple[str, Any]],
) -> list[Path]:
    directorio = Path(directorio)
    directorio.mkdir(parents=True, exist_ok=True)
    base = directorio / f'reporte-precios-{sello}-{modo}'
    principal = pd.DataFrame(filas_reporte(plan))
    dudosos = pd.DataFrame(plan.dudosos, columns=['ID', 'Producto', 'Categoría', 'Renglón parecido', 'Fila', 'Coincidencia %', 'Motivo', 'Alias sugerido'])
    sin_usar = pd.DataFrame(plan.sin_usar, columns=['Fila', 'Renglón de la lista', 'Precio en la lista', 'Presentación', 'Motivo'])
    tabla_resumen = pd.DataFrame(resumen, columns=['Dato', 'Valor'])
    tabla_resumen['Valor'] = tabla_resumen['Valor'].map(str)
    escritos: list[Path] = []

    if formato in ('xlsx', 'ambos'):
        ruta = base.with_suffix('.xlsx')
        with pd.ExcelWriter(ruta, engine='openpyxl') as libro:
            for nombre, tabla, colorear in (
                ('Productos', principal, True),
                ('Matches dudosos', dudosos, False),
                ('Lista sin usar', sin_usar, False),
                ('Resumen', tabla_resumen, False),
            ):
                _sin_formulas(tabla).to_excel(libro, sheet_name=nombre, index=False)
                _formatear_hoja(libro.sheets[nombre], tabla, colorear)
        escritos.append(ruta)

    if formato in ('csv', 'ambos'):
        # Punto y coma y coma decimal: es lo que espera Excel configurado en español.
        opciones = {'sep': ';', 'index': False, 'encoding': 'utf-8-sig'}
        ruta = base.with_suffix('.csv')
        _para_csv(principal).to_csv(ruta, **opciones)
        escritos.append(ruta)
        for sufijo, tabla in (('dudosos', dudosos), ('lista-sin-usar', sin_usar)):
            if not tabla.empty:
                extra = directorio / f'{base.name}-{sufijo}.csv'
                _para_csv(tabla).to_csv(extra, **opciones)
                escritos.append(extra)
    return escritos


def _numero_csv(valor: Any) -> str:
    """2100.0 -> "2100"; 1388.889 -> "1388,89". Sin separador de miles para que Excel lo lea como número."""
    if _vacia(valor):
        return ''
    if isinstance(valor, numbers.Real) and not isinstance(valor, bool):
        numero = round(float(valor), 4)
        if numero.is_integer():
            return str(int(numero))
        return f'{numero:.4f}'.rstrip('0').rstrip('.').replace('.', ',')
    return str(valor)


def _para_csv(tabla: pd.DataFrame) -> pd.DataFrame:
    copia = _sin_formulas(tabla)
    for columna in copia.columns:
        if pd.api.types.is_numeric_dtype(copia[columna]):
            copia[columna] = copia[columna].map(_numero_csv)
    return copia


# --------------------------------------------------------------------------- #
# Interfaz de línea de comandos                                               #
# --------------------------------------------------------------------------- #

EJEMPLOS = f"""
ejemplos:
  Simular (no cambia nada, genera el reporte en scripts/precios/reportes/):
    python scripts/actualizar_precios.py scripts/precios/lista-del-lunes.xlsx

  Aplicar los cambios en el sitio (pide {ENV_USUARIO} y {ENV_PASSWORD}):
    python scripts/actualizar_precios.py scripts/precios/lista-del-lunes.xlsx --aplicar

  Aplicar y además poner sin stock las frutas y verduras que no vinieron:
    python scripts/actualizar_precios.py lista.xlsx --aplicar --marcar-sin-stock

  La lista tiene columnas con nombres raros:
    python scripts/actualizar_precios.py lista.csv --col-producto "Mercadería" --col-precio "Valor"

  Probar sin conexión con un JSON de productos (igual a GET /api/products):
    python scripts/actualizar_precios.py scripts/precios/lista-mercado-ejemplo.csv \\
      --productos-json scripts/precios/productos-ejemplo.json --config scripts/precios/margenes.example.json

credenciales (solo para --aplicar):
  Variables de entorno {ENV_USUARIO} y {ENV_PASSWORD} (las mismas del panel). Si no
  están y la terminal es interactiva, se piden (la contraseña no se ve al tipear).
  Dirección del sitio: --url, la variable {ENV_URL} o "url" en el JSON
  (por defecto {URL_DEFAULT}).

códigos de salida:
  {EXIT_OK} todo bien (simulación hecha o cambios aplicados)
  {EXIT_ERROR_INESPERADO} error inesperado (ver el log en scripts/precios/logs/)
  {EXIT_USO} uso incorrecto (opciones inválidas)
  {EXIT_LISTA} problema con la lista (no existe, no se puede leer, faltan columnas)
  {EXIT_CONFIG} problema con la configuración o con el JSON de productos
  {EXIT_LOGIN} login fallido (credenciales, bloqueo por intentos, sesión vencida)
  {EXIT_API} el sitio no responde o respondió algo inesperado
  {EXIT_PARCIAL} se aplicó una parte: hubo productos rechazados o lotes sin enviar
  {EXIT_INTERRUMPIDO} cortado a mano (Ctrl+C)
"""


class _FormatoAyuda(argparse.RawDescriptionHelpFormatter):
    def add_usage(self, usage, actions, groups, prefix=None):
        return super().add_usage(usage, actions, groups, prefix or 'uso: ')


class _Parser(argparse.ArgumentParser):
    TRADUCCIONES = (
        ('the following arguments are required', 'faltan estos argumentos'),
        ('unrecognized arguments', 'no reconozco estos argumentos'),
        ('invalid choice', 'opción inválida'),
        ('choose from', 'elegí entre'),
        ('expected one argument', 'falta el valor'),
        ('invalid float value', 'número inválido'),
        ('invalid int value', 'número entero inválido'),
        ('not allowed with argument', 'no se puede usar junto con'),
        ('argument ', 'argumento '),
    )

    def error(self, message):
        for original, traduccion in self.TRADUCCIONES:
            message = message.replace(original, traduccion)
        self.print_usage(sys.stderr)
        self.exit(EXIT_USO, f'{self.prog}: error: {message}\n')


def crear_parser() -> argparse.ArgumentParser:
    parser = _Parser(
        prog='actualizar_precios.py',
        description=(
            'Actualiza los precios de la tienda El Pampa a partir de la lista mayorista del Mercado de Abasto.\n'
            'Por defecto SIMULA: no cambia nada y deja un reporte para revisar. Con --aplicar manda los cambios.'
        ),
        epilog=EJEMPLOS,
        formatter_class=_FormatoAyuda,
        add_help=False,
    )
    parser._positionals.title = 'argumentos'
    parser._optionals.title = 'opciones'
    parser.add_argument('-h', '--help', action='help', help='muestra esta ayuda y sale')
    parser.add_argument('--version', action='version', version=f'%(prog)s {VERSION}', help='muestra la versión y sale')
    parser.add_argument('lista', type=Path, help='lista del mercado: Excel (.xlsx) o CSV')

    modo = parser.add_argument_group('qué hacer')
    modo.add_argument('--aplicar', action='store_true', help='manda los cambios al sitio (sin esto, solo simula)')
    modo.add_argument('--forzar', action='store_true', help='aplica también los cambios que superan el límite de cambio')
    modo.add_argument('--marcar-sin-stock', action='store_true',
                      help='pone sin stock los productos que NO están en la lista (solo las categorías de "categorias_sin_stock")')
    modo.add_argument('--reactivar', action='store_true', help='vuelve a poner disponibles los productos sin stock que sí vinieron en la lista')
    modo.add_argument('--si', action='store_true', help='no pide confirmación antes de aplicar')

    fuentes = parser.add_argument_group('configuración y datos')
    fuentes.add_argument('--config', type=Path, metavar='ARCHIVO',
                         help=f'JSON con márgenes, alias, redondeo, etc. (por defecto {CONFIG_PROPIA.name} o, si no existe, {CONFIG_EJEMPLO.name})')
    fuentes.add_argument('--productos-json', type=Path, metavar='ARCHIVO',
                         help='usa los productos de este JSON en vez de bajarlos del sitio (solo para simular)')
    fuentes.add_argument('--url', help=f'dirección del sitio (por defecto {ENV_URL}, "url" del JSON o {URL_DEFAULT})')

    columnas = parser.add_argument_group('columnas de la lista (si la autodetección no las encuentra)')
    columnas.add_argument('--hoja', help='hoja del Excel (por defecto, la primera que tenga producto y precio)')
    columnas.add_argument('--col-producto', metavar='NOMBRE', help='columna con el nombre del producto')
    columnas.add_argument('--col-precio', metavar='NOMBRE', help='columna con el precio mayorista')
    columnas.add_argument('--col-unidad', metavar='NOMBRE', help='columna con la presentación ("Cajón 18 kg")')
    columnas.add_argument('--col-kilos', metavar='NOMBRE', help='columna con los kilos por bulto')
    columnas.add_argument('--col-unidades', metavar='NOMBRE', help='columna con las unidades por bulto')
    columnas.add_argument('--precio-por', choices=MODOS_PRECIO_POR,
                          help='el precio de la lista es por bulto, por kg, o auto (lo deduce de cada renglón)')

    calculo = parser.add_argument_group('cálculo')
    calculo.add_argument('--umbral', type=float, help='coincidencia mínima del nombre, 0 a 1 o en %% (por defecto 0.85)')
    calculo.add_argument('--limite-cambio', type=float, metavar='PCT', help='cambio máximo permitido sin --forzar, en %% (por defecto 40)')
    calculo.add_argument('--redondeo', type=float, metavar='MULTIPLO', help='redondea todos los precios a este múltiplo (ej. 50 o 100)')

    salida = parser.add_argument_group('salida')
    salida.add_argument('--formato-reporte', choices=('xlsx', 'csv', 'ambos'), default='ambos', help='formato del reporte (por defecto ambos)')
    salida.add_argument('--dir-reportes', type=Path, default=DIR_REPORTES, metavar='CARPETA', help='carpeta de los reportes (por defecto scripts/precios/reportes)')
    salida.add_argument('--dir-logs', type=Path, default=DIR_LOGS, metavar='CARPETA', help='carpeta de los logs (por defecto scripts/precios/logs)')
    salida.add_argument('--lote', type=int, metavar='N', help=f'productos por envío al sitio (1 a {MAX_LOTE}, por defecto {MAX_LOTE})')
    salida.add_argument('--reintentos', type=int, default=4, metavar='N', help='reintentos ante errores de red o del sitio (por defecto 4)')
    verbosidad = salida.add_mutually_exclusive_group()
    verbosidad.add_argument('-v', '--detallado', action='store_true', help='muestra más detalle en la consola')
    verbosidad.add_argument('-q', '--silencioso', action='store_true', help='solo muestra avisos y errores')
    return parser


class _FormatoConsola(logging.Formatter):
    PREFIJOS = {logging.WARNING: 'AVISO: ', logging.ERROR: 'ERROR: ', logging.CRITICAL: 'ERROR: '}

    def format(self, record: logging.LogRecord) -> str:
        return self.PREFIJOS.get(record.levelno, '') + record.getMessage()


def configurar_logging(dir_logs: Path | None, nivel_consola: int, sello: str) -> tuple[list[logging.Handler], Path | None]:
    log.setLevel(logging.DEBUG)
    log.propagate = False
    for handler in list(log.handlers):
        log.removeHandler(handler)
        handler.close()

    consola = logging.StreamHandler(sys.stderr)
    consola.setLevel(nivel_consola)
    consola.setFormatter(_FormatoConsola())
    log.addHandler(consola)
    handlers: list[logging.Handler] = [consola]

    ruta_log = None
    if dir_logs is not None:
        try:
            Path(dir_logs).mkdir(parents=True, exist_ok=True)
            ruta_log = Path(dir_logs) / f'actualizar-precios-{sello}.log'
            archivo = logging.FileHandler(ruta_log, encoding='utf-8')
            archivo.setLevel(logging.DEBUG)
            archivo.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
            log.addHandler(archivo)
            handlers.append(archivo)
        except OSError as error:
            ruta_log = None
            log.warning('No pude crear el log en %s (%s). Sigo sin archivo de log.', dir_logs, error)
    return handlers, ruta_log


def obtener_credenciales(interactivo: bool) -> tuple[str, str]:
    usuario = os.environ.get(ENV_USUARIO, '').strip()
    password = os.environ.get(ENV_PASSWORD, '')
    if (not usuario or not password) and interactivo:
        log.info('No están %s / %s: te los pido acá (la contraseña no se ve al tipear).', ENV_USUARIO, ENV_PASSWORD)
        if not usuario:
            usuario = input('Usuario del panel: ').strip()
        if not password:
            password = getpass.getpass('Contraseña del panel: ')
    if not usuario or not password:
        raise ErrorLogin(
            f'Faltan las credenciales del panel. Definí las variables de entorno {ENV_USUARIO} y {ENV_PASSWORD} '
            '(ver scripts/precios/README.md).'
        )
    return usuario, password


def _elegir_config(ruta: Path | None) -> Path:
    if ruta:
        return ruta
    if CONFIG_PROPIA.exists():
        return CONFIG_PROPIA
    log.warning(
        'No existe %s: uso la configuración de EJEMPLO (%s). Copiala como %s y poné tus márgenes.',
        CONFIG_PROPIA.name, CONFIG_EJEMPLO.name, CONFIG_PROPIA.name,
    )
    return CONFIG_EJEMPLO


ETIQUETAS_RESUMEN = [
    (ESTADO_ACTUALIZAR, 'Precios para actualizar', ''),
    (ESTADO_ACTUALIZADO, 'Precios actualizados', ''),
    (ESTADO_REACTIVAR, 'Para reactivar (mismo precio)', ''),
    (ESTADO_REACTIVADO, 'Reactivados', ''),
    (ESTADO_SIN_CAMBIOS, 'Sin cambios', ''),
    (ESTADO_BLOQUEADO_LIMITE, 'Bloqueados por el límite de cambio', 'revisalos; si están bien, corré con --forzar'),
    (ESTADO_BLOQUEADO_OFERTA, 'Bloqueados por una oferta', 'cambiá o sacá la oferta en el panel'),
    (ESTADO_DUDOSO, 'Matches dudosos', 'si son el mismo producto, agregá un alias en el JSON'),
    (ESTADO_REVISAR, 'Para revisar', 'mirá la columna Detalle del reporte'),
    (ESTADO_SIN_MATCH, 'Sin match (no están en la lista)', ''),
    (ESTADO_MARCAR_SIN_STOCK, 'Pasan a sin stock', ''),
    (ESTADO_MARCADO_SIN_STOCK, 'Marcados sin stock', ''),
    (ESTADO_EXCLUIDO, 'Excluidos por configuración', ''),
    (ESTADO_RECHAZADO, 'Rechazados por el sitio', 'mirá la columna Detalle del reporte'),
    (ESTADO_NO_ENCONTRADO, 'Ya no existen en el sitio', ''),
    (ESTADO_NO_ENVIADO, 'No enviados', 'volvé a correr el script cuando el sitio ande'),
    (ESTADO_INTERRUMPIDO, 'Interrumpidos', 'volvé a correr el script'),
]


def _lineas_resumen(plan: Plan) -> list[tuple[str, int, str]]:
    conteo = plan.contar()
    return [(etiqueta, conteo[estado], pista) for estado, etiqueta, pista in ETIQUETAS_RESUMEN if conteo.get(estado)]


def _mostrar_resumen(plan: Plan, aplicado: bool, reportes: list[Path]) -> None:
    titulo = 'RESULTADO' if aplicado else 'RESULTADO DE LA SIMULACIÓN (no se cambió nada en el sitio)'
    log.info('')
    log.info('== %s ==', titulo)
    lineas = _lineas_resumen(plan)
    ancho = max((len(etiqueta) for etiqueta, _, _ in lineas), default=10) + 2
    for etiqueta, cantidad, pista in lineas:
        log.info('  %s %4d%s', etiqueta.ljust(ancho, '.'), cantidad, f'   -> {pista}' if pista else '')
    if plan.sin_usar:
        log.info('  %s %4d   -> ver hoja "Lista sin usar"', 'Renglones de la lista sin usar'.ljust(ancho, '.'), len(plan.sin_usar))
    for ruta in reportes:
        log.info('Reporte: %s', ruta)


def _detalle_para_consola(plan: Plan) -> None:
    """Lo que necesita atención va a la consola; el resto, al log y al reporte."""
    atencion = (ESTADO_BLOQUEADO_LIMITE, ESTADO_BLOQUEADO_OFERTA, ESTADO_DUDOSO, ESTADO_REVISAR)
    for fila in plan.filas:
        precio = f'{formato_pesos(fila.producto.precio)} -> {formato_pesos(fila.precio_nuevo)}' if fila.precio_nuevo is not None else ''
        texto = f'[{fila.estado}] {fila.producto.nombre} {precio} {formato_pct(fila.cambio_pct) if fila.cambio_pct is not None else ""}'.rstrip()
        if fila.estado in atencion:
            log.warning('%s. %s', texto, fila.detalle)
        else:
            log.debug('%s. %s', texto, fila.detalle)


def _confirmar(plan: Plan) -> bool:
    cambios = plan.actualizaciones
    partes = [
        f'{sum(1 for item in cambios if "price" in item)} precios',
        f'{sum(1 for item in cambios if item.get("available") is False)} productos a sin stock',
        f'{sum(1 for item in cambios if item.get("available") is True)} reactivaciones',
    ]
    respuesta = input(f'Se van a cambiar en el sitio: {", ".join(partes)}. ¿Seguimos? Escribí "si" para confirmar: ')
    return normalizar_liviano(respuesta) in ('s', 'si', 'y', 'yes')


def main(argv: list[str] | None = None, *, dormir: Callable[[float], None] = time.sleep, interactivo: bool | None = None) -> int:
    parser = crear_parser()
    args = parser.parse_args(argv)
    if interactivo is None:
        interactivo = sys.stdin.isatty()

    if args.aplicar and args.productos_json:
        parser.error('--aplicar necesita los productos actuales del sitio: no se puede usar con --productos-json')
    if args.lote is not None and not 1 <= args.lote <= MAX_LOTE:
        parser.error(f'--lote tiene que estar entre 1 y {MAX_LOTE}')
    if args.reintentos < 0:
        parser.error('--reintentos no puede ser negativo')

    sello = datetime.now().strftime('%Y%m%d-%H%M%S')
    nivel = logging.DEBUG if args.detallado else logging.WARNING if args.silencioso else logging.INFO
    handlers, ruta_log = configurar_logging(args.dir_logs, nivel, sello)
    try:
        return _ejecutar(args, sello, dormir, interactivo, ruta_log)
    except ErrorScript as error:
        log.error('%s', error)
        return error.codigo_salida
    except KeyboardInterrupt:
        log.error('Cortado a mano.')
        return EXIT_INTERRUMPIDO
    except Exception as error:  # noqa: BLE001 - último recurso: que quede en el log
        log.error('Error inesperado: %s%s', error, f' (detalle en {ruta_log})' if ruta_log else '')
        log.debug('Traceback:', exc_info=True)
        return EXIT_ERROR_INESPERADO
    finally:
        for handler in handlers:
            log.removeHandler(handler)
            handler.close()


def _ejecutar(args: argparse.Namespace, sello: str, dormir: Callable[[float], None], interactivo: bool, ruta_log: Path | None) -> int:
    ruta_config = _elegir_config(args.config)
    config = cargar_configuracion(ruta_config)
    log.info('Configuración: %s', ruta_config)

    # Lo que viene por línea de comandos pisa al JSON.
    if args.umbral is not None:
        config.umbral_match = _umbral_config(args.umbral, '--umbral')
        config.umbral_dudoso = min(config.umbral_dudoso, config.umbral_match)
    if args.limite_cambio is not None:
        config.limite_cambio_pct = _numero_config(args.limite_cambio, '--limite-cambio', 1, 1000)
    if args.redondeo is not None:
        config.redondeo = Redondeo(config.redondeo.modo, ((None, _numero_config(args.redondeo, '--redondeo', 0)),))
    if args.precio_por:
        config.precio_por = args.precio_por
    if args.lote is not None:
        config.tamano_lote = args.lote
    for rol in SINONIMOS_COLUMNAS:
        valor = getattr(args, f'col_{rol}')
        if valor:
            config.columnas[rol] = valor
    validar_umbrales(config)

    lista = leer_lista(args.lista, args.hoja, config.columnas, config.ignorar_en_lista)
    columnas = ', '.join(f'{NOMBRES_ROLES[rol]}="{nombre}"' for rol, nombre in lista.columnas.items())
    log.info(
        'Lista: %s%s, encabezado en la fila %s. Columnas: %s. %s renglones con producto.',
        args.lista.name, f' (hoja "{lista.hoja}")' if lista.hoja else '', lista.fila_encabezado, columnas, len(lista.renglones),
    )
    if lista.precio_por_kg_por_encabezado and config.precio_por == 'auto':
        log.info('El encabezado del precio dice "kg": se toman los precios como precio por kilo.')
    if not lista.renglones:
        raise ErrorLista(f'La lista "{args.lista.name}" no tiene renglones con producto y precio debajo del encabezado.')

    if args.productos_json:
        productos = cargar_productos_json(args.productos_json)
        log.info('Productos: %s (%s, sin conexión).', len(productos), args.productos_json.name)
    else:
        url = normalizar_url(args.url or os.environ.get(ENV_URL) or config.url or URL_DEFAULT)
        # Por http:// el usuario y la contraseña del panel viajarían sin cifrar
        # en el primer request (antes de cualquier redirección): se corta acá.
        if url.startswith('http://') and urlsplit(url).hostname not in HOSTS_LOCALES:
            raise ErrorConfig(
                f'La dirección tiene que ser https:// (vino "{url}"): por http:// el usuario y la '
                'contraseña del panel viajarían sin cifrar.'
            )
        cliente = ClienteApi(url, reintentos=args.reintentos, dormir=dormir)
        if args.aplicar:
            usuario, password = obtener_credenciales(interactivo)
            cliente.iniciar_sesion(usuario, password)
        productos = cliente.obtener_productos()
        log.info('Productos: %s (bajados de %s).', len(productos), url)
    if not productos:
        raise ErrorApi('La tienda no tiene productos cargados: no hay nada que actualizar.')

    opciones = Opciones(forzar=args.forzar, marcar_sin_stock=args.marcar_sin_stock, reactivar=args.reactivar)
    plan = armar_plan(productos, lista, config, opciones)
    for aviso in plan.avisos:
        log.warning('%s', aviso)
    _detalle_para_consola(plan)
    if not any(fila.renglon for fila in plan.filas if fila.estado != ESTADO_DUDOSO):
        log.warning('Ningún producto coincidió con la lista. ¿Es la lista correcta? ¿Las columnas detectadas están bien?')

    resultado: ResultadoAplicacion | None = None
    codigo = EXIT_OK
    if args.aplicar:
        if not plan.actualizaciones:
            log.info('No hay cambios para aplicar.')
        elif interactivo and not args.si and not _confirmar(plan):
            log.info('No se aplicó nada.')
            args.aplicar = False
        else:
            resultado = aplicar_cambios(cliente, plan, config.tamano_lote)
            codigo = _codigo_resultado(resultado)

    resumen = [
        ('Fecha', datetime.now().strftime('%d/%m/%Y %H:%M')),
        ('Modo', 'aplicado' if resultado is not None else 'simulación'),
        ('Lista', str(args.lista)),
        ('Configuración', str(ruta_config)),
        ('Productos en la tienda', len(productos)),
        ('Renglones de la lista', len(lista.renglones)),
        ('Márgenes %', ', '.join(f'{c} {formato_numero(m)}' for c, m in config.margenes_pct.items()) + f', resto {formato_numero(config.margen_default_pct)}'),
        ('Redondeo', config.redondeo.describir()),
        ('Límite de cambio %', formato_numero(config.limite_cambio_pct)),
        ('Coincidencia mínima %', round(config.umbral_match * 100)),
    ] + [(etiqueta, cantidad) for etiqueta, cantidad, _ in _lineas_resumen(plan)]
    if ruta_log:
        resumen.append(('Log', str(ruta_log)))

    try:
        modo = 'aplicado' if resultado is not None else 'simulacion'
        reportes = escribir_reportes(plan, args.dir_reportes, args.formato_reporte, sello, modo, resumen)
    except OSError as error:
        log.error('No pude escribir el reporte en %s: %s', args.dir_reportes, error)
        reportes = []
        if resultado is None:
            codigo = EXIT_ERROR_INESPERADO

    _mostrar_resumen(plan, aplicado=resultado is not None, reportes=reportes)
    if ruta_log:
        log.info('Log: %s', ruta_log)

    if resultado is None:
        if plan.actualizaciones and not args.aplicar:
            log.info('Para aplicar los cambios, corré el mismo comando agregando --aplicar.')
        return codigo

    if resultado.interrumpido:
        log.error('Cortado a mano durante el envío. Revisá el reporte y volvé a correr el script.')
        return EXIT_INTERRUMPIDO
    if resultado.error_fatal:
        log.error('%s', resultado.error_fatal)
    if resultado.aplicados:
        log.info('Listo: se guardaron %s cambios en el sitio (la tienda ya los muestra).', resultado.aplicados)
    return codigo


def _codigo_resultado(resultado: ResultadoAplicacion) -> int:
    if resultado.interrumpido:
        return EXIT_INTERRUMPIDO
    if resultado.error_fatal:
        return EXIT_PARCIAL if resultado.aplicados else resultado.error_fatal.codigo_salida
    if resultado.rechazados:
        return EXIT_PARCIAL
    return EXIT_OK


if __name__ == '__main__':
    sys.exit(main())
