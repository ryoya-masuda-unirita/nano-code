export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}

export function factorial(n: number): number {
  if (n < 0) throw new Error('Negative input');
  if (!Number.isInteger(n)) throw new Error('Non-integer input');
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}
