import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        // Couleur d'accent unique : changer ici suffit à rethémer l'app.
        brand: colors.indigo,
        ink: colors.slate
      },
      fontFamily: {
        // Polices système : aucune requête externe, donc 100% hors-ligne.
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px -8px rgb(15 23 42 / 0.10)'
      }
    }
  },
  plugins: []
}
