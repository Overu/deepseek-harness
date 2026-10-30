/** Static HTML resources embedded by the native renderer build. */
declare module '*.html?raw' {
  const html: string
  export default html
}
