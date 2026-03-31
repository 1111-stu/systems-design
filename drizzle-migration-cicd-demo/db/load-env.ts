import { config } from 'dotenv';

let loaded = false;

export const loadEnv = () => {
  if (loaded) return;
  config();
  loaded = true;
};
