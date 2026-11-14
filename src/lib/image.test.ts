import { expect, test } from 'vitest'
import { packRows, toBlack } from './image'

const lum = (...values: number[]) => Float32Array.from(values)

test('anything darker than light grey prints black', () => {
  expect([...toBlack(lum(0, 169, 170, 255), 4, 1, false, 0)]).toEqual([1, 1, 0, 0])
})

test('Thick grows a black dot into its four neighbours, Extra thick twice', () => {
  const dot = () => {
    const l = new Float32Array(25).fill(255)
    l[12] = 0
    return l
  }
  const rows = (black: Uint8Array) => [0, 1, 2, 3, 4].map((y) => black.slice(y * 5, y * 5 + 5).join(''))
  expect(rows(toBlack(dot(), 5, 5, false, 1))).toEqual(['00000', '00100', '01110', '00100', '00000'])
  expect(rows(toBlack(dot(), 5, 5, false, 2))).toEqual(['00100', '01110', '11111', '01110', '00100'])
})

test('Sketch shades mid grey as a mix of dots and is never fattened', () => {
  const black = toBlack(new Float32Array(64 * 64).fill(128), 64, 64, true, 2)
  const share = black.reduce((sum, b) => sum + b, 0) / black.length
  expect(share).toBeGreaterThan(0.4)
  expect(share).toBeLessThan(0.6)
})

test('rows are packed least significant bit first', () => {
  const black = new Uint8Array(16)
  black[0] = 1 // first dot of the line -> bit 0 of byte 0
  black[9] = 1 // tenth dot -> bit 1 of byte 1
  expect(packRows(black, 16, 1).map((row) => [...row])).toEqual([[0b1, 0b10]])
})
