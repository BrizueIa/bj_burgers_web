import { hash } from '@node-rs/argon2';
const password = process.argv[2];
if (!password || password.length < 12)
  throw new Error('Provide a password with at least 12 characters.');
console.log(await hash(password, { memoryCost: 19456, timeCost: 3, parallelism: 1 }));
