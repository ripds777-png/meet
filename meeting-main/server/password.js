// Eight independently sampled pronounceable words, 12 bits each: 96 bits.
// No Math.random, modulo bias, shared defaults or password logging.
export function temporaryPassword(){
 const consonants='bcdfghjkmnprstvw',vowels='aeio';
 const samples=crypto.getRandomValues(new Uint16Array(8));
 return [...samples].map(n=>{n&=4095;return consonants[n&15]+vowels[(n>>4)&3]+consonants[(n>>6)&15]+vowels[(n>>10)&3];}).join('-')+'7!';
}
