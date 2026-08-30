# Hero redesign — Design QA

## Evidence

- Source visual truth: `/Users/reetsingh/Desktop/Screenshot 2026-08-30 at 2.50.59 PM.png`, with the Hydra website region normalized to `/private/tmp/reference-hydra-crop.png` at 1180 × 570 px. The other two supplied screenshots informed the cream/dark editorial typography and framed-media treatment.
- Implementation: `http://localhost:5173/`, captured to `/private/tmp/the-verifier-orange-hero.png` at the in-app browser's 877 × 757 CSS viewport and 1× density.
- Mobile implementation: `/private/tmp/the-verifier-orange-mobile.png`, 390 × 844 CSS px at 1× density.
- Combined comparison: `/private/tmp/the-verifier-hero-comparison.png`.
- State: initial landing-page hero, no workflow session started.

## Full-view comparison

The combined comparison confirms the requested shared art direction without reproducing the reference brand: flat saturated orange, cream navigation, near-black typography and actions, large editorial headline, outlined media frame, and a playful central image asset. The implementation preserves The Verifier's own claim, CTA, trust details, and evidence subject.

## Focused-region comparison

The focused hero comparison was necessary because the supplied screenshots are article captures around other websites rather than direct full-page mocks. The normalized Hydra region and The Verifier hero were placed in one comparison image. The generated magnifying-glass evidence artwork is sharp at its rendered crop, uses the correct orange/cream/black family, and avoids placeholder or code-drawn illustration.

## Required fidelity surfaces

- Fonts and typography: oversized heavy sans display type matches the bold reference hierarchy; compact navigation and uppercase assurance copy supply the editorial secondary scale. Wrapping is controlled on desktop and mobile.
- Spacing and layout rhythm: the hero uses generous breathing room, a dominant headline, and a framed visual. Mobile stacks copy before artwork with no horizontal overflow.
- Colors and visual tokens: `#ff702a`, `#f6f0e7`, `#171719`, and deep brown shadows closely reflect the supplied orange/cream/black direction. The product workspace retains its darker operational palette intentionally.
- Image quality and asset fidelity: `public/hero-verification.png` is a 1448 × 1086 generated raster asset with a clean 4:3 crop and no third-party branding. It replaces the former code-native evidence preview as the hero focal point.
- Copy and content: the requested headline, explanation, and `Verify a claim` action remain unchanged and visually dominant.

## Findings

- No P0, P1, or P2 findings remain.
- P3: the generated image uses a polished 3D editorial collage, whereas one supplied reference uses a flatter mascot collage. This is an intentional product-specific adaptation that avoids copying the reference character.

## Comparison history

- Earlier state: dark navy hero with a small dashboard-like evidence preview did not match the requested high-color editorial references.
- Fix: introduced the orange/cream/black marketing palette, custom raster artwork, hard outlined framing, larger display typography, cream navigation, and gentle motion.
- Post-fix evidence: the combined comparison and mobile capture show matching color energy, hierarchy, media prominence, and responsive integrity.

## Interaction and responsive checks

- Primary CTA behavior remains covered by the UI test that asserts smooth scrolling into the live verifier.
- Hero image loaded at its natural 1448 px width.
- Desktop/current browser capture: no horizontal overflow.
- Mobile 390 × 844 capture: no horizontal overflow.
- Motion respects the existing reduced-motion media query.

final result: passed
