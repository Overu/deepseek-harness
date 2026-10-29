/** Plain CSS is a side-effect stylesheet; text consumers opt into ?inline. */
declare module '*.css'

/** CSS source text for plugin-owned lifecycle injection. */
declare module '*.css?inline' {
  const css: string
  export default css
}
