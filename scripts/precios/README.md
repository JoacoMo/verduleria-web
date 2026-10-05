# Actualizar los precios con la lista del mercado

Este script toma la lista de precios mayoristas del Mercado de Abasto (el Excel o
CSV que te pasan en el puesto), la compara con los productos de la tienda y calcula
el precio de venta de cada uno con **tu margen** y **tu redondeo**.

Primero **simula**: no cambia nada y te deja un reporte en Excel para revisar.
Cuando está todo bien, lo corrés de nuevo con `--aplicar` y los precios nuevos
aparecen en la tienda al instante.

> En resumen: **guardar la lista → simular → mirar el reporte → aplicar.**

---

## Índice

1. [Preparar la compu (una sola vez)](#1-preparar-la-compu-una-sola-vez)
2. [Cada vez que llega la lista](#2-cada-vez-que-llega-la-lista)
3. [Cómo leer el reporte](#3-cómo-leer-el-reporte)
4. [Cómo se calcula el precio](#4-cómo-se-calcula-el-precio)
5. [La configuración (margenes.json)](#5-la-configuración-margenesjson)
6. [Qué listas entiende](#6-qué-listas-entiende)
7. [Opciones útiles](#7-opciones-útiles)
8. [Problemas frecuentes](#8-problemas-frecuentes)
9. [Para quien mantiene el código](#9-para-quien-mantiene-el-código)

---

## 1. Preparar la compu (una sola vez)

### Instalar Python

- **Windows:** bajalo de <https://www.python.org/downloads/> e instalalo. En la
  primera pantalla del instalador **tildá "Add python.exe to PATH"**.
- **Mac:** bajalo de la misma página, o con Homebrew: `brew install python`.

Para comprobar que quedó instalado, abrí una terminal (en Windows: menú Inicio →
"PowerShell") y escribí:

```
python --version
```

Tiene que decir `Python 3.10` o un número más alto. En Windows, si `python` no
anda, probá con `py` en todos los comandos de esta guía.

### Instalar las librerías

En la terminal, parate en la carpeta del proyecto (la que tiene `package.json`) y
corré:

```
python -m pip install -r scripts/requirements.txt
```

### Crear tu configuración

Copiá el archivo `scripts/precios/margenes.example.json` en la misma carpeta con el
nombre **`margenes.json`** y abrilo con el Bloc de notas (o cualquier editor de
texto). Ahí van tus márgenes, el redondeo y los "alias" de nombres. Está explicado
en la [sección 5](#5-la-configuración-margenesjson).

Si no creás `margenes.json`, el script usa el de ejemplo y te avisa.

---

## 2. Cada vez que llega la lista

Todos los comandos se escriben en la terminal, parado en la carpeta del proyecto.

### Paso 1: guardar la lista

Guardá el Excel o CSV del mercado dentro de `scripts/precios/`, por ejemplo como
`scripts/precios/lista-lunes.xlsx`. (Puede estar en cualquier carpeta; es solo para
tenerlo a mano.)

### Paso 2: simular

```
python scripts/actualizar_precios.py scripts/precios/lista-lunes.xlsx
```

Esto **no cambia nada en la tienda**. Te muestra un resumen como este:

```
== RESULTADO DE LA SIMULACIÓN (no se cambió nada en el sitio) ==
  Precios para actualizar.............   18
  Sin cambios.........................    2
  Bloqueados por el límite de cambio..    1   -> revisalos; si están bien, corré con --forzar
  Bloqueados por una oferta...........    1   -> cambiá o sacá la oferta en el panel
  Matches dudosos.....................    1   -> si son el mismo producto, agregá un alias en el JSON
  Para revisar........................    1   -> mirá la columna Detalle del reporte
  Sin match (no están en la lista)....    3
  Excluidos por configuración.........    1
  Renglones de la lista sin usar......    4   -> ver hoja "Lista sin usar"
Reporte: scripts/precios/reportes/reporte-precios-20261005-101500-simulacion.xlsx
```

### Paso 3: mirar el reporte

Abrí el Excel que dice `Reporte:` (está en `scripts/precios/reportes/`). Revisá
sobre todo lo que está en amarillo y rojo. Qué significa cada cosa está en la
[sección 3](#3-cómo-leer-el-reporte).

Si algo está mal (un nombre que no reconoció, un margen que querés cambiar),
corregí `margenes.json` y volvé al paso 2. Podés simular todas las veces que
quieras.

### Paso 4: aplicar

```
python scripts/actualizar_precios.py scripts/precios/lista-lunes.xlsx --aplicar
```

Te va a pedir el **usuario y la contraseña del panel** (la contraseña no se ve
mientras la escribís, es normal) y te muestra cuántos cambios va a hacer antes de
seguir: escribí `si` para confirmar.

Al terminar deja otro reporte (`...-aplicado.xlsx`) con lo que efectivamente se
guardó en el sitio.

Lo más simple es dejar que te los pida cada vez. Si no querés tipear el usuario,
cargalo en la terminal (dura mientras la ventana esté abierta) y el script solo te
va a pedir la contraseña:

- Windows (PowerShell): `$env:ELPAMPA_USER = "tu-usuario"`
- Mac / Linux: `export ELPAMPA_USER="tu-usuario"`

Para una tarea programada (sin nadie que tipee), definí `ELPAMPA_USER` y
`ELPAMPA_PASSWORD` como variables de entorno de esa tarea y agregá `--si` para que no
pregunte. **Nunca escribas la contraseña dentro de `margenes.json` ni de ningún
archivo del proyecto**, ni como parte de un comando (queda en el historial de la
terminal).

---

## 3. Cómo leer el reporte

El Excel tiene cuatro hojas:

- **Productos**: una fila por cada producto de la tienda.
- **Matches dudosos**: productos que tienen un nombre parecido en la lista pero no lo
  suficiente como para estar seguros. Trae el alias sugerido para copiar.
- **Lista sin usar**: renglones de la lista que no se usaron para ningún producto
  (porque no los vendés, porque no se reconoció el nombre o porque el precio no se
  pudo leer).
- **Resumen**: fecha, configuración usada y totales.

### La columna "Estado"

| Estado | Qué quiere decir | Qué hacer |
| --- | --- | --- |
| **actualizar** | Tiene precio nuevo. | Nada: se aplica con `--aplicar`. |
| **sin cambios** | El precio calculado es igual al actual. | Nada. |
| **bloqueado por límite** | El precio cambiaría más del ±40 % (o el límite que pusiste). Suele ser un error de tipeo en la lista ("$ 72.000" en vez de "$ 27.000"). | Mirá el renglón en la lista. Si el precio es correcto, aplicá con `--forzar`. |
| **bloqueado por oferta** | El producto tiene una oferta vigente y el precio nuevo quedaría igual o por debajo de la oferta. El sitio no lo permite. | Cambiá o sacá la oferta desde el panel y volvé a correr el script. |
| **match dudoso** | Hay un renglón parecido ("LECHUGA CRIOLLA" para "Lechuga") pero no alcanza para estar seguro. **No se toca.** | Si es el mismo producto, agregá el alias en `margenes.json` (la hoja "Matches dudosos" trae el texto listo para copiar). |
| **revisar** | Se encontró el renglón pero no se pudo calcular: el precio está ilegible ("consultar") o la lista lo vende por kilo y la tienda por unidad. | Leé la columna "Detalle". Para kilo → unidad, cargá `kg_por_unidad`. |
| **sin match** | El producto no aparece en la lista. | Nada (o usá `--marcar-sin-stock`, ver abajo). |
| **marcar sin stock** | No vino en la lista y corriste con `--marcar-sin-stock`. | Se pone "sin stock" al aplicar. |
| **reactivar** | Estaba sin stock, volvió en la lista y corriste con `--reactivar`. | Se vuelve a poner disponible al aplicar. |
| **excluido** | Está en `productos_excluidos` o `categorias_excluidas`. | Nada: el script no lo toca. |

Después de `--aplicar` aparecen además:

| Estado | Qué quiere decir |
| --- | --- |
| **actualizado / marcado sin stock / reactivado** | Se guardó en el sitio. |
| **rechazado por el servidor** | El sitio no aceptó ese producto (el motivo está en "Detalle"). Los demás sí se guardaron. |
| **no encontrado en el sitio** | El producto se borró mientras corría el script. |
| **no enviado** | Se cortó internet o el sitio no respondió. Volvé a correr el script: es seguro repetirlo. |

La columna **Detalle** muestra la cuenta que hizo, por ejemplo:
`Cajón 18 kg: $ 25.000 ÷ 18 kg = $ 1.388,89 por kg.`

---

## 4. Cómo se calcula el precio

1. **Costo por unidad de venta.** Si la lista trae el precio por bulto, se divide por
   los kilos o unidades del bulto:
   - Tomate, cajón de 18 kg a $ 25.000 → $ 1.388,89 el kilo.
   - Acelga, 12 atados a $ 7.200 → $ 600 el atado.
   - Jengibre (en la tienda va por gramo), caja de 5 kg a $ 33.000 → $ 6.600 el kilo
     → $ 6,60 el gramo.
2. **Margen** de la categoría (o del producto, si le pusiste uno propio):
   $ 1.388,89 + 50 % = $ 2.083,33.
3. **Redondeo comercial**: con "a $ 50 hacia arriba" queda **$ 2.100**.
   - Para lo que va por gramo se redondea el precio del kilo y después se divide.
4. **Controles de seguridad** antes de tocar nada:
   - Si cambia más del límite (±40 % por defecto) → *bloqueado por límite*.
   - Si choca con una oferta vigente → *bloqueado por oferta*.
   - Si el nombre no coincide con seguridad → no se toca.

---

## 5. La configuración (margenes.json)

Es un archivo de texto en formato JSON. Ojo con dos cosas: los textos van entre
comillas dobles y **no puede quedar una coma después del último elemento** de una
lista o bloque. Si te equivocás, el script te dice en qué línea está el error.

Las claves que empiezan con `_` (como `"_comentario"`) son notas y se ignoran.

| Clave | Para qué sirve | Ejemplo |
| --- | --- | --- |
| `url` | Dirección del sitio. | `"https://elpampa.vercel.app"` |
| `margenes_pct` | Ganancia en % por categoría. `default` es para el resto. | `{"Frutas": 45, "Verduras": 50, "default": 40}` |
| `margenes_por_producto_pct` | Margen propio para un producto (pisa al de la categoría). | `{"Palta": 60}` |
| `redondeo` | Modo (`arriba`, `cercano` o `abajo`) y tramos: hasta qué precio se redondea a qué múltiplo. | ver abajo |
| `limite_cambio_pct` | Cambio máximo (para arriba o para abajo) que se aplica sin `--forzar`. | `40` |
| `umbral_match` | Qué tan parecido tiene que ser el nombre para usarlo (0 a 1; 0.85 = 85 %). | `0.85` |
| `umbral_dudoso` | Desde qué parecido se reporta como "match dudoso". | `0.6` |
| `alias` | Nombre en la lista → nombre en la tienda. No importan mayúsculas ni tildes. | `{"tomate perita": "Tomate"}` |
| `kg_por_unidad` | Para lo que la lista vende por kilo y la tienda por unidad: cuánto pesa cada una. | `{"Palta": 0.25}` |
| `columnas` | Solo si no reconoce las columnas de la lista: el nombre exacto del encabezado. | `{"precio": "Valor bulto"}` |
| `precio_por` | `auto` (lo deduce), `bulto` (siempre por bulto) o `kg` (siempre por kilo). | `"auto"` |
| `categorias_sin_stock` | Qué categorías puede poner sin stock `--marcar-sin-stock`. | `["Frutas", "Verduras"]` |
| `categorias_excluidas` / `productos_excluidos` | Lo que el script nunca toca (por ejemplo, los bolsones, que armás a mano). | `["Bolsones"]` |
| `ignorar_en_lista` | Renglones de la lista que no son productos. | `["flete", "envases"]` |
| `tamano_lote` | Cuántos productos se mandan juntos al sitio (1 a 200). | `200` |

Redondeo por tramos (el ejemplo que viene):

```json
"redondeo": {
  "modo": "arriba",
  "tramos": [
    { "hasta": 1000, "multiplo": 10 },
    { "hasta": 10000, "multiplo": 50 },
    { "multiplo": 100 }
  ]
}
```

Quiere decir: hasta $ 1.000 redondea a $ 10 ($ 975 → $ 980), hasta $ 10.000 a
$ 50 ($ 2.083 → $ 2.100) y de ahí para arriba a $ 100. Si querés algo simple:
`"redondeo": 50`.

### Alias: cuando la lista usa otro nombre

El script compara los nombres sin mayúsculas, sin tildes, en singular y sin palabras
de envase o calidad ("x 18 kg", "cajón", "1ra", "primera"). Así "ZANAHORIAS x 20 KG"
y "Zanahoria" son lo mismo sin hacer nada.

Cuando la lista usa un nombre distinto ("TOMATE PERITA" para tu "Tomate"), agregá un
alias:

```json
"alias": {
  "tomate perita": "Tomate",
  "papa negra": "Papa"
}
```

Si la lista trae dos calidades ("TOMATE PERITA 1RA" y "TOMATE PERITA 2DA"), con
`"tomate perita"` se usa la primera que aparece en la lista. Para elegir otra,
poné el nombre completo: `"tomate perita 2da": "Tomate"`.

---

## 6. Qué listas entiende

- **Formatos:** Excel (`.xlsx`) o CSV (con `;` o `,`). Un `.xls` viejo: abrilo en
  Excel y guardalo como `.xlsx`.
- **Títulos arriba de la tabla:** no hay problema; busca solo dónde empieza la tabla.
  Los renglones de sección ("FRUTAS", "VERDURAS") se saltean.
- **Columnas que reconoce solo** (sin importar mayúsculas ni tildes):
  - producto: "Producto", "Descripción", "Artículo", "Detalle", "Mercadería"…
  - precio: "Precio", "Precio mayorista", "$", "Valor", "Importe"…
  - presentación: "Presentación", "Unidad", "Bulto", "Envase"…
  - kilos por bulto: "Kg por bulto", "Kilos", "Kg", "Peso"…
  - unidades por bulto: "Unidades por bulto", "U x bulto"…
- **Precios:** "$ 25.000", "25.000,50", "25000" o un número de Excel. "consultar" o
  vacío se reporta como ilegible y ese producto no se toca.
- **Presentación:** entiende "Cajón 18 kg", "x18kg", "Bolsa 20 kilos", "Caja x 10
  bandejas", "x 12 atados", "Bolsa x 50 u", "docena", "x kg" (precio por kilo) y
  "Bandeja 125 g" (precio por bandeja). También la busca en el nombre ("TOMATE x 18 KG").
- Si el encabezado del precio dice kilo ("Precio x kg"), se toman todos los precios
  como precio por kilo.

Si no encuentra una columna, te dice qué columnas vio para que se la indiques:

```
python scripts/actualizar_precios.py lista.xlsx --col-precio "Valor bulto"
```

(o cargala en `"columnas"` de `margenes.json` para no escribirla cada vez).

---

## 7. Opciones útiles

| Opción | Qué hace |
| --- | --- |
| `--aplicar` | Manda los cambios al sitio. Sin esto, solo simula. |
| `--forzar` | Aplica también los que superan el límite de cambio. Usalo solo después de revisar el reporte. |
| `--marcar-sin-stock` | Pone sin stock lo que no vino en la lista. Solo toca las categorías de `categorias_sin_stock` (Frutas y Verduras), nunca un "match dudoso" y nunca Almacén ni Bolsones. |
| `--reactivar` | Vuelve a poner disponible lo que estaba sin stock y volvió en la lista. |
| `--si` | No pregunta antes de aplicar (para tareas programadas). |
| `--hoja "Nombre"` | Hoja del Excel a usar (por defecto, la primera que tenga producto y precio). |
| `--col-producto`, `--col-precio`, `--col-unidad`, `--col-kilos`, `--col-unidades` | Nombre de la columna si no la reconoce sola. |
| `--precio-por bulto` / `kg` | Fuerza cómo leer los precios de la lista. |
| `--umbral 0.9` | Exige nombres más parecidos (o menos, con un número más bajo). |
| `--limite-cambio 60` | Cambia el límite de seguridad (en %). |
| `--redondeo 100` | Redondea todo a ese múltiplo. |
| `--formato-reporte xlsx` | Solo Excel (por defecto hace Excel y CSV). |
| `--productos-json archivo.json` | Usa los productos de un archivo en vez de bajarlos del sitio (para probar sin internet; no se puede combinar con `--aplicar`). |
| `-v` / `-q` | Más detalle / menos detalle en la pantalla. |

`python scripts/actualizar_precios.py --help` muestra todas las opciones con ejemplos.

### Probar sin internet

Con los archivos de ejemplo de esta carpeta:

```
python scripts/actualizar_precios.py scripts/precios/lista-mercado-ejemplo.xlsx --productos-json scripts/precios/productos-ejemplo.json --config scripts/precios/margenes.example.json
```

---

## 8. Problemas frecuentes

| Mensaje | Qué hacer |
| --- | --- |
| `No encontré el archivo ...` | Revisá el nombre y la carpeta. Si el nombre tiene espacios, ponelo entre comillas. |
| `No encontré la columna de precio ... Columnas que encontré: ...` | Usá `--col-precio "Nombre de la columna"` con uno de los nombres que te muestra. |
| `¿está abierto en Excel?` | Cerrá el archivo en Excel y probá de nuevo. |
| `... no es un JSON válido (línea 12 ...)` | Hay un error de tipeo en `margenes.json` en esa línea (casi siempre una coma de más o de menos, o una comilla). |
| `Usuario o contraseña incorrectos` | Son los mismos del panel. Si los cargaste con `$env:`/`export`, revisalos. |
| `El sitio bloqueó el login por demasiados intentos` | Esperá los minutos que dice y revisá la contraseña antes de reintentar. |
| `no se pudo conectar después de 5 intentos` | Revisá internet. Si internet anda, el sitio puede estar caído: probá en un rato. |
| `el sitio redirige a ...` | Usá esa dirección con `--url` o en `"url"` de `margenes.json`. |
| Muchos "sin match" | ¿Es la lista correcta? Mirá la hoja "Lista sin usar" y agregá alias. |

Los detalles de cada corrida quedan en `scripts/precios/logs/` (la contraseña nunca se
guarda). Los reportes y los logs no se suben al repositorio.

### Códigos de salida (para tareas programadas)

| Código | Significado |
| --- | --- |
| 0 | Todo bien (simulación hecha o cambios aplicados). |
| 1 | Error inesperado (ver el log). |
| 2 | Opciones inválidas. |
| 3 | Problema con la lista (no existe, no se puede leer, faltan columnas). |
| 4 | Problema con la configuración o con el JSON de productos. |
| 5 | Login fallido (credenciales, bloqueo por intentos, sesión vencida). |
| 6 | El sitio no responde o respondió algo inesperado. |
| 7 | Se aplicó una parte: hubo productos rechazados o lotes sin enviar. |
| 130 | Cortado a mano (Ctrl+C). |

---

## 9. Para quien mantiene el código

- **Archivos:** `scripts/actualizar_precios.py` (el script), `scripts/test_actualizar_precios.py`
  (tests), `scripts/requirements.txt` y esta carpeta con los ejemplos:
  `margenes.example.json`, `lista-mercado-ejemplo.csv`, `lista-mercado-ejemplo.xlsx`
  (generado con pandas: misma mercadería que el CSV, con títulos arriba de la tabla,
  otros nombres de columna y números de Excel) y `productos-ejemplo.json` (misma
  forma que `GET /api/products`).
- **API que usa:**
  - `GET /api/products` (público) para leer los productos. La simulación no inicia
    sesión.
  - `POST /api/gestion/login` con `{username, password}`: devuelve la cookie httpOnly
    `elpampa_admin` (Path `/api/gestion`), que `requests.Session` guarda y manda sola.
  - `POST /api/gestion/products/bulk` con `{updates: [{id, price?, available?}]}` en
    lotes de hasta 200. Es todo o nada por lote; si el servidor rechaza un ítem
    (400 con `index`), el script lo saca y reenvía el resto del lote.
- **Reintentos:** errores de red, 5xx y 429 (respetando `Retry-After`), con espera
  exponencial. Los 4xx no se reintentan, y un 429 en el login tampoco (es el freno
  contra fuerza bruta). Reenviar un lote es seguro: el bulk pone valores absolutos.
- **Reglas que replica del servidor** (si cambian allá, hay que cambiarlas acá):
  categorías y unidades (`src/lib/product-categories.ts`, `src/lib/product-units.ts`),
  la regla "la oferta vigente tiene que quedar por debajo del precio"
  (`assertOfferConsistency` en `src/lib/validation.ts`), el tope de precio
  (`MAX_PRICE`) y el máximo por lote (`MAX_BULK_UPDATES`).
- **Tests:** `python -m unittest scripts/test_actualizar_precios.py -v`. No usan
  internet: la parte HTTP corre contra un servidor falso (`http.server` en un hilo)
  que imita el login con cookie, el catálogo y el bulk.
