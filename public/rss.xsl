<?xml version="1.0" encoding="UTF-8"?>
<!--
  What a browser shows when somebody opens the feed.

  A feed is XML addressed to a program, and a browser handed one with no
  stylesheet prints its own warning above a syntax-highlighted document tree.
  It is not broken — it is a machine-readable file being read by the wrong kind
  of reader — but on a site built this carefully it looks like a fault, and the
  person who clicked "feed" wanted to subscribe, not to inspect markup.

  So the feed carries this. Feed readers ignore a stylesheet and parse the XML
  exactly as before; browsers render the page below instead. Nothing about the
  feed's contract changes.

  Self-contained by necessity: an XSLT transform runs before the site's own
  stylesheet exists, and the built CSS is a hashed filename this file cannot
  know. So the palette is repeated here — the one place on the site where a
  colour is written twice, because the alternative is not writing it at all.
  Both themes are covered by `prefers-color-scheme`; there is no toggle here,
  because there is no script on this page to remember one.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns="http://www.w3.org/1999/xhtml">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="/rss/channel/title"/> — feed</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
        <style>
          :root {
            --paper: #E7E1CE;
            --paper-raised: #EFEADA;
            --ink: #1C1917;
            --ink-soft: #4B443C;
            --brass: #A6875A;
            --fundus: #7A3B2E;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --paper: #131110;
              --paper-raised: #1B1817;
              --ink: #E9E2D2;
              --ink-soft: #A79E8E;
              --brass: #8A6F49;
              --fundus: #C2705C;
            }
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--paper);
            color: var(--ink);
            font-family: Georgia, 'EB Garamond', 'Times New Roman', serif;
            line-height: 1.7;
          }
          .wrap { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.5rem 5rem; }
          .kicker {
            font-family: ui-monospace, 'IBM Plex Mono', 'SF Mono', Menlo, monospace;
            font-size: 0.72rem;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--brass);
            margin: 0 0 0.6rem;
          }
          h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 0.8rem; font-weight: 400; }
          .lede { color: var(--ink-soft); margin: 0 0 1.6rem; }
          .note {
            border: 1px solid color-mix(in srgb, var(--brass) 55%, transparent);
            background: var(--paper-raised);
            padding: 1rem 1.15rem;
            margin: 0 0 2.5rem;
            font-size: 0.95rem;
            color: var(--ink-soft);
          }
          .note code {
            font-family: ui-monospace, 'IBM Plex Mono', 'SF Mono', Menlo, monospace;
            font-size: 0.85em;
            color: var(--ink);
            word-break: break-all;
          }
          a { color: var(--fundus); text-decoration: none; border-bottom: 1px solid currentColor; }
          a:hover { color: var(--ink); }
          hr { border: 0; border-top: 1px solid var(--brass); opacity: 0.55; margin: 0 0 2rem; }
          ol { list-style: none; margin: 0; padding: 0; }
          li { padding: 1.15rem 0; border-top: 1px solid color-mix(in srgb, var(--brass) 30%, transparent); }
          li:first-child { border-top: 0; }
          .item-t { font-size: 1.12rem; margin: 0 0 0.25rem; font-weight: 400; }
          .item-t a { border-bottom: 0; color: var(--ink); }
          .item-t a:hover { color: var(--fundus); }
          .item-d { margin: 0 0 0.35rem; color: var(--ink-soft); font-size: 0.98rem; }
          .item-m {
            font-family: ui-monospace, 'IBM Plex Mono', 'SF Mono', Menlo, monospace;
            font-size: 0.72rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--brass);
            margin: 0;
          }
          .back { margin-top: 3rem; font-size: 0.95rem; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <p class="kicker">RSS feed</p>
          <h1><xsl:value-of select="/rss/channel/title"/></h1>
          <p class="lede"><xsl:value-of select="/rss/channel/description"/></p>

          <div class="note">
            <strong>This page is a feed.</strong> Paste its address into a feed
            reader and everything below arrives there as it is written — no
            account, no algorithm, nothing that can decide what you see.
            <br/>
            <!-- The channel link carries no trailing slash (the feed is built
                 with `trailingSlash: false`), so the separator belongs here.
                 Without it this read "https://asifuddin.comrss.xml". -->
            <code><xsl:value-of select="concat(/rss/channel/link, '/rss.xml')"/></code>
          </div>

          <hr/>

          <ol>
            <xsl:for-each select="/rss/channel/item">
              <li>
                <h2 class="item-t">
                  <a><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute>
                    <xsl:value-of select="title"/>
                  </a>
                </h2>
                <p class="item-d"><xsl:value-of select="description"/></p>
                <p class="item-m"><xsl:value-of select="substring(pubDate, 1, 16)"/></p>
              </li>
            </xsl:for-each>
          </ol>

          <p class="back">
            <a><xsl:attribute name="href"><xsl:value-of select="/rss/channel/link"/></xsl:attribute>
              Back to the site
            </a>
          </p>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
