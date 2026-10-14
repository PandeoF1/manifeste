/** What a parser variant must give back for one page. */
export interface ParserOutput {
  /** Text handed to the AI and the judge. */
  text: string
  title: string
  publishedAt: Date | null
  /** Set by parsers that detect bot walls and paywalls. */
  blocked?: { reason: string } | null
}

export interface ParserVariant {
  name: string
  description: string
  parse(html: string, url: string): ParserOutput | Promise<ParserOutput>
}
