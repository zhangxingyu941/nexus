import { networkInterfaces } from "node:os";

function getLocalIpv4Addresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => (item.family === "IPv4" || item.family === 4) && !item.internal)
    .map((item) => item.address);
}

function getAllowedDevOrigins() {
  const configuredOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([...configuredOrigins, ...getLocalIpv4Addresses()])];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  reactStrictMode: true,
};

export default nextConfig;
