import ptBR from '../i18n/pt-BR.json'

export type Key = keyof typeof ptBR

/** Jogo em português do Brasil. Mantém a interface de chaves para facilitar novos idiomas. */
export class I18n {
  readonly locale = 'pt-BR'
  constructor() {
    document.documentElement.lang = 'pt-BR'
  }
  t(key: Key, vars?: Record<string, string | number>): string {
    return format(ptBR[key] ?? String(key), vars)
  }
}

export function format(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}
