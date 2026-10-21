import { describe, expect, it } from 'vitest'
import { defaultSave, parseSave } from '../src/engine/save'

describe('save de espécies e assistência', () => {
  it('ativa as opções novas em saves v1 antigos que não as possuem', () => {
    const old = defaultSave() as Record<string, unknown>
    delete old.birdId
    delete old.flightAssist
    const migrated = parseSave(JSON.stringify(old))
    expect(migrated.birdId).toBe('sabia')
    expect(migrated.flightAssist).toBe(true)
  })

  it('preserva uma espécie e uma escolha de assistência válidas', () => {
    const saved = parseSave(JSON.stringify({ ...defaultSave(), birdId: 'andorinha', flightAssist: false }))
    expect(saved.birdId).toBe('andorinha')
    expect(saved.flightAssist).toBe(false)
  })

  it('substitui espécies inválidas sem corromper o restante do save', () => {
    const saved = parseSave(JSON.stringify({ ...defaultSave(), birdId: 'dragao' }))
    expect(saved.birdId).toBe('sabia')
    expect(saved.quality).toBe(defaultSave().quality)
  })
})
