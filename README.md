# 🍔 BJ Burgers - Menú Digital

Una página web moderna y responsiva para el menú digital de **BJ Burgers**. Diseño atractivo con tema de fuego y navegación intuitiva.

## ✨ Características

- 🔥 Diseño moderno con tema de fuego (colores naranja y rojo)
- 📱 Completamente responsivo (mobile, tablet, desktop)
- 🎨 Interfaz intuitiva y atractiva
- ⚡ Carga rápida y optimizada
- 🌙 Tema oscuro por defecto
- 🔤 Tipografía profesional con Google Fonts
- 📐 Grid y diseño flexible

## 🚀 Inicio Rápido

### Requisitos
- Navegador web moderno (Chrome, Firefox, Safari, Edge)
- Conexión a internet (para cargar Google Fonts)

### Instalación Local

1. **Clona el repositorio:**
   ```bash
   git clone https://github.com/BrizueIa/bj_burgers_web.git
   cd bj_burgers_web
   ```

2. **Abre el archivo en tu navegador:**
   - Opción 1: Haz doble clic en `index.html`
   - Opción 2: Click derecho → Abrir con → Navegador preferido
   - Opción 3: Usa un servidor local (recomendado)

### Servidor Local (Alternativa recomendada)

**Con Python:**
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

**Con Node.js y http-server:**
```bash
npx http-server
```

**Con Live Server (VS Code):**
- Instala la extensión "Live Server"
- Click derecho en `index.html` → "Open with Live Server"

Luego accede a `http://localhost:8000` (o el puerto indicado)

## 📁 Estructura del Proyecto

```
bj_burgers_web/
├── index.html          # Página principal
├── README.md           # Este archivo
├── LICENSE             # Licencia del proyecto
└── assets/             # (Futuro) Carpeta para imágenes, CSS, JS
```

## 🎯 Tecnologías Utilizadas

- **HTML5:** Estructura semántica
- **CSS3:** Estilos modernos con:
  - Variables CSS (Custom Properties)
  - Flexbox y Grid
  - Gradientes y efectos visuales
  - Animaciones suaves
  - Responsive Design
- **Google Fonts:** Tipografías profesionales
  - Bebas Neue
  - Oswald
  - Nunito

## 🎨 Paleta de Colores

| Color | Hex | Uso |
|-------|-----|-----|
| Fire | `#ff6b00` | Color principal |
| Fire Bright | `#ffaa00` | Destaques |
| Fire Dark | `#cc4400` | Variante oscura |
| Gold | `#ffd700` | Acentos |
| Background | `#0a0a0a` | Fondo principal |

## 🔧 Configuración y Personalización

### Cambiar Colores
Edita las variables CSS en la sección `:root` del archivo `index.html`:

```css
:root {
  --fire: #ff6b00;
  --fire-bright: #ffaa00;
  --fire-dark: #cc4400;
  --gold: #ffd700;
  --bg: #0a0a0a;
  /* ... */
}
```

### Agregar Nuevas Secciones
1. Abre `index.html` en tu editor de texto
2. Agrega HTML en el `<body>`
3. Crea estilos CSS correspondientes
4. Prueba en el navegador

## 📱 Responsividad

El sitio está optimizado para:
- 📱 Teléfonos (320px - 480px)
- 📱 Tablets (768px - 1024px)
- 🖥️ Desktops (1024px+)

## 🌐 Despliegue

### Opción 1: GitHub Pages
1. Ve a Configuración del repositorio
2. Activa GitHub Pages
3. Selecciona rama `main`
4. Tu sitio estará en: `https://BrizueIa.github.io/bj_burgers_web`

### Opción 2: Netlify
1. Conecta tu repositorio en Netlify
2. Configura como sitio estático
3. Deploy automático en cada push

### Opción 3: Vercel
1. Importa el repositorio en Vercel
2. Selecciona configuración de sitio estático
3. Despliega con un clic

## 📝 Guía de Contribución

¿Quieres contribuir? ¡Excelente!

1. Fork el repositorio
2. Crea una rama para tu feature: `git checkout -b feature/AmazingFeature`
3. Commit tus cambios: `git commit -m 'Add some AmazingFeature'`
4. Push a la rama: `git push origin feature/AmazingFeature`
5. Abre un Pull Request

## 🐛 Reporte de Problemas

Si encuentras un bug, por favor abre un [issue](https://github.com/BrizueIa/bj_burgers_web/issues) con:
- Descripción del problema
- Pasos para reproducirlo
- Navegador y sistema operativo
- Capturas de pantalla (si aplica)

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver archivo [LICENSE](LICENSE) para más detalles.

## 👨‍💻 Autor

**BrizueIa** - Creador del proyecto BJ Burgers Web

## 🙏 Agradecimientos

- Google Fonts por las tipografías
- La comunidad de desarrollo web

---

**Última actualización:** Marzo 2026

¿Preguntas? ¡Abre un issue o contacta al autor!
