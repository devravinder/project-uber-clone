import { randomBytes } from "node:crypto";

// ULID: 48-bit time + 80-bit random, Crockford base32. Lexicographic order is time order.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = -1;
let lastRandom: number[] = [];

function freshRandom(): number[] {
  return Array.from(randomBytes(16), (b) => b & 31);
}

// Monotonic inside one process: two ids in the same millisecond still sort in creation order.
export function newId(now: number = Date.now()): string {
  if (now === lastTime) {
    let i = 15;
    while (i >= 0 && lastRandom[i] === 31) lastRandom[i--] = 0;
    if (i >= 0) lastRandom[i]!++;
  } else {
    lastTime = now;
    lastRandom = freshRandom();
  }
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  return time + lastRandom.map((n) => ALPHABET[n]).join("");
}

// Millisecond timestamp encoded in an id.
export function idTime(id: string): number {
  return id
    .slice(0, 10)
    .split("")
    .reduce((acc, c) => acc * 32 + ALPHABET.indexOf(c), 0);
}
