/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard reads the local NDJSON store at request time, so pages are always dynamic.
  // On Vercel this means committing data/ to the repo or running ingestion in CI before build.
  // Those reads use a runtime-built path, so file tracing does not always pick the store up on
  // its own; naming it here keeps data/ inside the serverless bundle. config/ traces already.
  outputFileTracingIncludes: {
    '/': ['./data/**']
  },
  experimental: {}
}

export default nextConfig
