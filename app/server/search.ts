export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
  source: 'duckduckgo' | 'wikipedia';
};

export type ImageSearchResult = {
  title: string;
  url: string;
  thumbnail?: string;
};

export type TopicResearch = {
  query: string;
  results: SearchResult[];
  insights: string[];
  contextText: string;
  images?: ImageSearchResult[];
};

/**
 * Clean user prompts like "make a 20 sec reel on Google Gemini 1.5 Pro"
 * into a search query like "Google Gemini 1.5 Pro".
 */
export const extractSearchQuery = (prompt: string): string => {
  let cleaned = prompt
    .replace(/(?:make|create|generate|produce|build)\s+(?:a|an)?\s*(?:\d+[\s-]*(?:second|sec|s|minute|min))?\s*(?:motion[- ]graphics?\s*)?(?:explainer\s*)?(?:video|reel|short|clip)\s*(?:about|on|explaining|for)?/i, '')
    .replace(/^(?:about|on|explain|showcase)\s+/i, '')
    .replace(/\b\d+\s*-?\s*(?:seconds?|secs?|minutes?|mins?)\b/gi, '')
    .trim();

  // Strip trailing prepositions
  cleaned = cleaned.replace(/\s+(?:in|for|with|about|of|on|to|and|by)\s*$/i, '').trim();

  // If over-cleaned or empty, fall back to first 8 words of the prompt
  if (cleaned.length < 3) {
    cleaned = prompt.split(/\s+/).slice(0, 8).join(' ');
  }

  return cleaned.slice(0, 120).trim();
};

const cleanText = (htmlOrText: string): string =>
  htmlOrText
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Free web search via DuckDuckGo Lite (no API key required).
 */
export const searchDuckDuckGoLite = async (query: string, limit = 5): Promise<SearchResult[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=['"]([^'"]+)['"][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

    const links = [...html.matchAll(linkRegex)];
    const snippets = [...html.matchAll(snippetRegex)];

    const results: SearchResult[] = [];
    for (let i = 0; i < links.length && results.length < limit; i++) {
      const url = links[i][1];
      // Skip ads and internal DDG links
      if (url.includes('duckduckgo.com/y.js') || url.includes('duckduckgo-help-pages')) {
        continue;
      }

      const title = cleanText(links[i][2]);
      const snippet = snippets[i] ? cleanText(snippets[i][1]) : '';

      if (title && snippet) {
        results.push({
          title,
          snippet,
          url,
          source: 'duckduckgo',
        });
      }
    }

    return results;
  } catch (error) {
    console.warn(`[search] DuckDuckGo search failed for '${query}':`, error instanceof Error ? error.message : error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Free Wikipedia Search API fallback (no API key required).
 */
export const searchWikipedia = async (query: string, limit = 4): Promise<SearchResult[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query,
    )}&utf8=&format=json&srlimit=${limit}`;

    const response = await fetch(endpoint, {
      headers: {
        'User-Agent': 'ShawttyReelAgent/1.0 (free educational reel pipeline)',
      },
      signal: controller.signal,
    });

    if (!response.ok) return [];

    type WikiResponse = {
      query?: {
        search?: Array<{ title?: string; snippet?: string; pageid?: number }>;
      };
    };

    const data = (await response.json()) as WikiResponse;
    const items = data.query?.search || [];

    return items
      .filter((item) => item.title && item.snippet)
      .map((item) => ({
        title: cleanText(item.title || ''),
        snippet: cleanText(item.snippet || ''),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((item.title || '').replace(/\s+/g, '_'))}`,
        source: 'wikipedia' as const,
      }));
  } catch (error) {
    console.warn(`[search] Wikipedia search failed for '${query}':`, error instanceof Error ? error.message : error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Combined free search tool that fetches topic data across DuckDuckGo and Wikipedia.
 */
export const searchWeb = async (query: string, maxResults = 5): Promise<SearchResult[]> => {
  // First attempt DuckDuckGo Lite
  const ddgResults = await searchDuckDuckGoLite(query, maxResults);
  if (ddgResults.length >= 3) {
    return ddgResults;
  }

  // Augment or fallback with Wikipedia
  const wikiResults = await searchWikipedia(query, maxResults - ddgResults.length);
  return [...ddgResults, ...wikiResults].slice(0, maxResults);
};

/**
 * Free DuckDuckGo image search (no API key required).
 * Extracts real character photos, landscapes, wallpapers and artwork from the web.
 */
export const searchImages = async (query: string, limit = 6): Promise<ImageSearchResult[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&iax=images&ia=images`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const html = await res.text();
    const vqdMatch = html.match(/vqd=([0-9-]+)/);
    if (!vqdMatch) return [];

    const vqd = vqdMatch[1];
    const imgRes = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Referer: 'https://duckduckgo.com/',
        },
        signal: controller.signal,
      },
    );
    if (!imgRes.ok) return [];

    type DDGImgData = { results?: Array<{ title?: string; image?: string; thumbnail?: string }> };
    const data = (await imgRes.json()) as DDGImgData;
    if (!data.results) return [];

    return data.results
      .filter((r) => r.image && /^https?:\/\//.test(r.image))
      .slice(0, limit)
      .map((r) => ({
        title: cleanText(r.title || query),
        url: r.image!,
        thumbnail: r.thumbnail,
      }));
  } catch (err) {
    console.warn(`[search] Image search failed for '${query}':`, err instanceof Error ? err.message : err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * High-level research function used by the reel planner.
 * Searches the web and produces factual bullet points, research context, and real web images.
 */
export const researchTopic = async (prompt: string): Promise<TopicResearch> => {
  const query = extractSearchQuery(prompt);
  console.log(`[research] Researching query: "${query}" for prompt: "${prompt}"`);

  const [results, images] = await Promise.all([
    searchWeb(query, 5),
    searchImages(`${query} wallpaper character anime art`, 6),
  ]);

  const insights = results.map((r) => `${r.title}: ${r.snippet}`);

  const contextText = results.length
    ? [
        `VERIFIED INTERNET RESEARCH ON "${query}":`,
        ...results.map(
          (r, idx) =>
            `[Source ${idx + 1}] ${r.title}\n${r.snippet}\nLink: ${r.url}`,
        ),
      ].join('\n\n')
    : `No live search results available for query "${query}". Use foundational knowledge.`;

  return {
    query,
    results,
    insights,
    contextText,
    images,
  };
};
