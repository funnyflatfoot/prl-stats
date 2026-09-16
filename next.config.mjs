/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard reads the local NDJSON store at request time, so pages are always dynamic.
  // On Vercel this means committing data/ to the repo or running ingestion in CI before build.
  // Those reads build their path at runtime, so naming the store here keeps it inside the
  // serverless bundle. On 14.x the key lives under experimental; it moves to the top level in 15.
  experimental: {
    outputFileTracingIncludes: {
      '/': ['./data/**']
    }
  }
}

export default nextConfig
