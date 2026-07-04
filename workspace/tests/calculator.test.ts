import { describe, it, expect } from 'bun:test'
import { add, subtract, multiply, divide, factorial } from '../src/calculator'

describe('calculator', () => {
  it('adds numbers', () => {
    expect(add(1, 2)).toBe(3)
  })

  it('subtracts numbers', () => {
    expect(subtract(5, 3)).toBe(2)
  })

  it('multiplies numbers', () => {
    expect(multiply(4, 3)).toBe(12)
  })

  it('divides numbers', () => {
    expect(divide(10, 2)).toBe(5)
  })

  it('throws on division by zero', () => {
    expect(() => divide(1, 0)).toThrow()
  })

  it('computes factorial', () => {
    expect(factorial(5)).toBe(120)
  })

  it('factorial of 0 is 1', () => {
    expect(factorial(0)).toBe(1)
  })

  it('throws on negative factorial', () => {
    expect(() => factorial(-1)).toThrow()
  })

  it('throws on non-integer factorial', () => {
    expect(() => factorial(3.5)).toThrow()
  })
})
