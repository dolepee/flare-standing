import { defineChain, getAddress, type Address } from "viem";

export const coston2 = defineChain({
  id: 114,
  name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] } },
});

export const registryAddress = getAddress("0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019");
export const defaultStandingAddress = getAddress("0x8a29c741280554028d76666dc75558d98caab855");

export function envAddress(name: string, fallback?: Address): Address {
  const value = process.env[name];
  if (!value) {
    if (fallback) return fallback;
    throw new Error(`${name} is required`);
  }
  return getAddress(value);
}
