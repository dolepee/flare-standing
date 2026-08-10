import { defineChain, getAddress } from "viem";

export const coston2 = defineChain({
  id: 114,
  name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] } },
});

export const registryAddress = getAddress("0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019");
