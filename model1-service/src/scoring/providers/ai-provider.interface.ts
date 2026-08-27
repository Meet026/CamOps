export interface OnvifGuessResult {
  onvifSupported: 'yes' | 'no' | 'unsure';
  reasoning: string;
}

export interface PhotoIdentifyResult {
  brand: string | null;
  model: string | null;
}

// Vendor-swap boundary: ScoringService depends on this interface only,
// never on a concrete provider class. Both methods return null on any
// failure (timeout, API error, malformed response) rather than throwing —
// callers treat null as "fall back to unknown," which is how FR-3's
// "AI failure must never block scoring" requirement is satisfied
// structurally rather than via try/catch scattered at call sites.
export interface AiProvider {
  guessOnvifSupport(brand: string, model: string): Promise<OnvifGuessResult | null>;
  identifyFromPhoto(photoUrl: string): Promise<PhotoIdentifyResult | null>;
}
