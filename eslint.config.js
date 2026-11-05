import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ],
    },
  },

  // Exceção para efeitos existentes que sincronizam
  // estados durante a navegação e consultas do painel.
  // Revisar em uma futura refatoração dos componentes.
  {
    files: [
      'src/App.tsx',
      'src/AtlasBrasil.tsx',
      'src/ComparacaoMunicipal.tsx',
      'src/HistoricoEstacoes.tsx',
      'src/ObservatorioMunicipal.tsx'
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off'
    }
  }
])
