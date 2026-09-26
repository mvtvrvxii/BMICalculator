# BMICalculator — BMIBrief

**BMIBrief** is a neutral, one-page BMI calculator for adults. It presents BMI as what
it is — a **screening measure, not a diagnosis** — with no alarm colors and no
good/bad labeling.

## Run it

No build step and no dependencies. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` in a browser.

## Features

**Free ($0, with ads)**
- Unlimited BMI calculations in metric or US customary units
- WHO adult categories presented neutrally (single-hue blue palette, no red/green)
- Key limitations shown beside every result; full limitations section below
- Adults-only by default — under-18 entries are routed to CDC/WHO child & teen
  (BMI-for-age percentile) guidance

**Pro ($4.99/month — local preview included)**
- Saved readings per profile
- SVG trend chart with the 18.5–25 reference band
- Printable appointment summaries (ad-free print stylesheet)
- Profile management (add, rename, delete)
- Check-in reminders
- Ad-free mode

Enable the Pro preview from the Plans section — it runs entirely in the browser,
no account or payment.

## Privacy & secure deletion

All data stays in `localStorage` on the device. Every delete operation (a reading,
a profile, or "delete all my data") first overwrites the stored bytes with random
data, then removes them (overwrite-then-erase).

## Accessibility & content policy

- WCAG AA-oriented color contrast; visible focus states; landmarks, labels, and
  `aria-live` result announcements; prefers-reduced-motion respected
- No red/green health judgments anywhere; validation errors use a calm amber
- Medical disclaimer, sources (WHO/CDC/NHLBI), and an evidence-based content
  review stamp: **last reviewed 26 September 2026, next review March 2027**

## Files

| File | Purpose |
|------|---------|
| `index.html` | One-page app markup |
| `styles.css` | Neutral design system + print stylesheet |
| `app.js` | Calculator, Pro preview, chart, reminders, secure deletion |
