// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared example prompts for make_ugc / the Agent chat — full, ready-to-edit
 * requests (not just an opening line) so a new user can see exactly what a
 * good prompt looks like: a concrete script, a person/character choice, and
 * the style knobs (look, captions, aspect ratio) that make_ugc actually
 * reads. Used by:
 *  - /dashboard/agent — as quick-start chips under the composer.
 *  - /dashboard/docs  — as a "Sample prompts" reference section.
 */

export interface SamplePrompt {
  label: string;
  prompt: string;
}

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    label: '🗣️ Talking-head UGC',
    prompt: "I want to make a talking-head UGC video.\n\n"
      + "Script: \"Okay this genuinely changed how I plan my week — I used to open five different apps just to remember what was due, now it's one glance and I know exactly what's next.\"\n\n"
      + "Person: a friendly 27-year-old woman, soft natural daylight, casual candid framing (or I can upload a photo / reuse a saved character instead).\n"
      + "Look: natural. Captions: on, TikTok style. Aspect ratio: 9:16.",
  },
  {
    label: '🛍️ Product review',
    prompt: "I want to make a product review video. I'll attach a photo of the product.\n\n"
      + "Script: \"I've tried so many phone stands and this is the first one that doesn't wobble — solid metal, folds flat for travel, and it still works with my case on.\"\n\n"
      + "Person: an enthusiastic person in a bright kitchen, holding the product up to camera.\n"
      + "Look: commercial. Captions: on, Hormozi style. Aspect ratio: 9:16.",
  },
  {
    label: '🎉 Hype clip (5s)',
    prompt: "I want a 5-second hype clip — no dialogue, just energy.\n\n"
      + "Scene: throwing both hands up and cheering straight at the camera, bright colorful background, quick punchy motion.\n"
      + "Use my saved character if I have one — otherwise generate a new person first.\n"
      + "Look: raw_iphone, for an authentic feel. Aspect ratio: 9:16.",
  },
  {
    label: '✨ New character',
    prompt: "I want to create a new reusable character I can use across future videos.\n\n"
      + "Description: a warm, approachable 30-year-old woman, curly brown hair, friendly smile, casual streetwear style.\n"
      + "(Or: I'll upload a reference photo and you build the character sheet from it.)\n\n"
      + "Keep her look consistent so I can reuse her by name in later requests.",
  },
  {
    label: '🎬 Product B-roll review',
    prompt: "I want to narrate over my own product B-roll footage instead of generating a scene.\n\n"
      + "B-roll video URL: https://…mp4 (footage of the product in use)\n\n"
      + "Script: \"Watch how easy this is to set up — no tools, no instructions, just clip it in and you're done.\"\n\n"
      + "Person: reuse my saved character, or describe one. Captions: on, minimal style. Aspect ratio: 9:16.",
  },
  {
    label: '💃 Silent action clip',
    prompt: "I want a short silent clip — no script, just a person doing something on camera.\n\n"
      + "Scene: dancing freestyle to an upbeat song, smiling at the camera, casual outfit, bright studio background.\n"
      + "This needs a saved character — I'll pick one, or create one first if I don't have one yet.\n"
      + "Look: natural. Aspect ratio: 9:16.",
  },
];

/**
 * Prompt Examples Library — a much larger, category-wise set of example
 * prompts (one dummy placeholder character per example, never a real saved
 * one) so a user can browse by ad style and see a concrete script before
 * writing their own. Complements SAMPLE_PROMPTS above (which stays as the
 * short flat quick-start chip list) with a deeper, browsable set. Used by:
 *  - /dashboard/gallery ("Prompt Examples" tab)
 *  - /dashboard/agent   ("+" menu -> "Browse examples")
 *  - /showcase and /onboarding/showcase (a curated subset, public-facing)
 */

export type PromptSkill = 'make_ugc' | 'make_product_in_hands' | 'make_podcast' | 'make_storybook';

export interface PromptTurn { speaker: string; line: string }
export interface PromptScene { speaker: string; visual: string; line: string }

export interface PromptExample {
  id: string;
  title: string;
  /** Dummy character name(s) — always a placeholder, never a real saved character. */
  character?: string;
  persona?: string;
  script?: string;
  /** Two-part script for the b-roll-narrated-review convention: an on-camera
   *  intro line, then narration that plays while b-roll takes over. */
  introLine?: string;
  narrationLine?: string;
  turns?: PromptTurn[];
  scenes?: PromptScene[];
  artStyle?: string;
  settings?: Record<string, string | number | boolean>;
  notes?: string;
}

export interface PromptExampleCategory {
  key: string;
  label: string;
  emoji: string;
  skill: PromptSkill;
  description: string;
  categoryNote?: string;
  examples: PromptExample[];
}

export const PROMPT_EXAMPLE_CATEGORIES: PromptExampleCategory[] = [
  {
    key: 'testimonial',
    label: 'Product Testimonial / Review',
    emoji: '🗣️',
    skill: 'make_ugc',
    description: "The workhorse UGC format — a real-looking customer speaking directly to camera about why they love a product. Works for almost any physical or digital product.",
    examples: [
      {
        id: 'testimonial-skincare',
        title: 'Skincare',
        character: 'Maya Torres',
        persona: 'late 20s, warm and a little skeptical-sounding, bathroom mirror lighting',
        script: "I almost didn't buy this because I've tried six serums that did nothing. Three weeks in, my skin actually looks different — not filtered-different, actually different. My sister asked what I did to my face.",
        settings: { look: 'natural', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'hormozi', product_image: '[placeholder — your product photo]' },
      },
      {
        id: 'testimonial-kitchen-gadget',
        title: 'Kitchen gadget',
        character: 'Deshawn Miles',
        persona: "30s dad, kitchen counter, slightly rushed energy like he's mid-dinner-prep",
        script: "My wife rolled her eyes when I ordered this. Now she's the one hiding it from the kids. It's paid for itself in the takeout we're not ordering anymore.",
        settings: { look: 'raw_iphone', duration: 10, aspect_ratio: '9:16', captions: true, caption_style: 'tiktok', product_image: '[placeholder]' },
      },
      {
        id: 'testimonial-saas',
        title: 'SaaS / app',
        character: 'Priya Nandan',
        persona: 'freelance designer, laptop open on a desk, direct and confident tone',
        script: "I used to spend Sunday nights redoing my invoices by hand. Now it's four clicks and I'm done before my coffee's cold. I've told every freelancer I know.",
        settings: { look: 'commercial', duration: 15, aspect_ratio: '1:1', captions: true, caption_style: 'minimal' },
      },
    ],
  },
  {
    key: 'before_after',
    label: 'Before & After / Transformation',
    emoji: '🔄',
    skill: 'make_ugc',
    description: 'Leans on a visible contrast — skin, space, energy, results — delivered as a confession rather than a sales pitch.',
    examples: [
      {
        id: 'before-after-fitness',
        title: 'Fitness / supplement',
        character: 'Jordan Blake',
        persona: 'mid-30s, gym locker room, out of breath but grinning',
        script: "Eight weeks ago I couldn't do a single pull-up. I'm not saying it's magic — I still had to show up — but recovery stopped wrecking me the next day, so I actually did show up.",
        settings: { look: 'raw_iphone', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'hormozi', product_image: '[placeholder]' },
      },
      {
        id: 'before-after-home-org',
        title: 'Home organization product',
        character: 'Renata Alvez',
        persona: 'early 40s, standing in a garage, hands on hips',
        script: 'This used to be a place I avoided opening the door to. Three bins and one weekend later, I can actually find my own tools. My husband thinks I hired someone.',
        settings: { look: 'natural', duration: 20, aspect_ratio: '9:16', captions: true, caption_style: 'tiktok', product_image: '[placeholder]' },
      },
    ],
  },
  {
    key: 'unboxing',
    label: 'Unboxing / First Impressions',
    emoji: '📦',
    skill: 'make_ugc',
    description: 'Captures the moment a package arrives — curiosity, texture, first reaction. Great for anything with satisfying packaging or a tactile hook.',
    examples: [
      {
        id: 'unboxing-beauty-box',
        title: 'Beauty box',
        character: 'Lena Cho',
        persona: 'early 20s, sitting cross-legged on a bed, box in lap',
        script: "Okay, this packaging alone is doing something to me. Look at this — they even lined the inside. If the product's half this good I'm already a customer.",
        settings: { look: 'raw_iphone', duration: 10, aspect_ratio: '9:16', captions: true, caption_style: 'tiktok', product_image: '[placeholder]' },
      },
      {
        id: 'unboxing-tech-accessory',
        title: 'Tech accessory',
        character: 'Omar Farsi',
        persona: 'late 20s, desk setup in background, calm and analytical tone',
        script: "No plastic clamshell, no fighting a hundred twist ties — just open the lid and it's sitting right there, charged. Somebody in this company actually cares about the first sixty seconds.",
        settings: { look: 'commercial', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'minimal', product_image: '[placeholder]' },
      },
      {
        id: 'unboxing-snack-box',
        title: 'Subscription snack box',
        character: 'Bianca Reyes',
        persona: 'college student, dorm room, excited and fast-talking',
        script: 'They said mystery flavors and I did not expect this many. I\'m trying the purple one first because I genuinely have no idea what it is.',
        settings: { look: 'raw_iphone', duration: 10, aspect_ratio: '9:16', captions: true, caption_style: 'hormozi', product_image: '[placeholder]' },
      },
    ],
  },
  {
    key: 'problem_solution',
    label: 'Problem → Solution',
    emoji: '💡',
    skill: 'make_ugc',
    description: 'Names a specific, relatable frustration first, then introduces the product as the fix. The frustration has to feel real, not manufactured.',
    examples: [
      {
        id: 'problem-solution-travel-gear',
        title: 'Travel gear',
        character: 'Tobias Wren',
        persona: '30s, airport terminal, mildly exasperated tone',
        script: "Every single trip my charger cable died in the one bag I couldn't reach. This clips to the strap I'm already wearing, so now it's the one thing I never have to dig for.",
        settings: { look: 'raw_iphone', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'tiktok', product_image: '[placeholder]' },
      },
      {
        id: 'problem-solution-cleaning',
        title: 'Cleaning product',
        character: 'Grace Odom',
        persona: '40s, kitchen, hands on counter, matter-of-fact delivery',
        script: "I scrubbed this stove for ten minutes every week for years. One spray, wipe, done — I actually laughed the first time because I thought it wouldn't work.",
        settings: { look: 'natural', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'hormozi', product_image: '[placeholder]' },
      },
      {
        id: 'problem-solution-productivity-app',
        title: 'Productivity app',
        character: 'Nadia Hollis',
        persona: 'late 20s, home office, direct to camera, slightly deadpan',
        script: "My to-do list used to live in four different apps and none of them talked to each other. Now it's one list, and things I forget to do actually text me back.",
        settings: { look: 'commercial', duration: 10, aspect_ratio: '1:1', captions: true, caption_style: 'minimal' },
      },
    ],
  },
  {
    key: 'day_in_life',
    label: 'Day-in-the-Life / Routine Integration',
    emoji: '☀️',
    skill: 'make_ugc',
    description: 'Shows the product as one small beat inside an ordinary routine — morning, commute, workday — rather than the whole focus of the video. Feels observed, not staged.',
    examples: [
      {
        id: 'day-in-life-coffee',
        title: 'Coffee / morning routine',
        character: 'Ellis Park',
        persona: 'late 20s, kitchen, still half-asleep energy',
        script: "This is the only part of my morning I don't rush. Everything else can be chaos, but I've got ninety seconds where it's just this and it's quiet.",
        settings: { look: 'raw_iphone', duration: 10, aspect_ratio: '9:16', captions: true, caption_style: 'minimal', product_image: '[placeholder]' },
      },
      {
        id: 'day-in-life-wellness',
        title: 'Wellness / supplement',
        character: 'Simone Achebe',
        persona: '30s, getting ready for work, talking while moving around the room',
        script: "I used to hit a wall around 2pm every single day. I added one thing to my morning and I stopped dreading my afternoon meetings — that's genuinely it.",
        settings: { look: 'natural', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'tiktok', product_image: '[placeholder]' },
      },
    ],
  },
  {
    key: 'founder_story',
    label: 'Founder / Behind-the-Brand Story',
    emoji: '🧑‍💼',
    skill: 'make_ugc',
    description: 'The character speaks as the person who built the product, not a customer. Builds trust through candor — what went wrong, what they fixed, why they still do it.',
    examples: [
      {
        id: 'founder-story-d2c',
        title: 'D2C brand founder',
        character: 'Marcus Feld',
        persona: 'late 30s, small warehouse or workshop background, sincere and a little tired-but-proud',
        script: "We got our first batch back from the factory and half of them were wrong. I could've shipped them anyway. Instead we ate the cost and redid it, because I only wanted to sell something I'd actually give my own kid.",
        settings: { look: 'raw_iphone', duration: 20, aspect_ratio: '9:16', captions: true, caption_style: 'minimal' },
      },
      {
        id: 'founder-story-solo',
        title: 'Solo founder / app',
        character: 'Aisha Okonkwo',
        persona: 'late 20s, home office, warm and direct',
        script: 'I built the first version of this at 1am because I was the one who needed it. Two years later it turns out a lot of people had the exact same 1am problem.',
        settings: { look: 'natural', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'hormozi' },
      },
    ],
  },
  {
    key: 'comparison',
    label: "Comparison / \"I tried it so you don't have to\"",
    emoji: '⚖️',
    skill: 'make_ugc',
    description: 'Positions the character as having already done the research — tested alternatives, formed an opinion — and is now handing the audience the shortcut.',
    examples: [
      {
        id: 'comparison-budget-vs-premium',
        title: 'Budget vs. premium',
        character: 'Colin Vance',
        persona: "30s, casual, talking with the slight authority of someone who's tested a lot of gear",
        script: "I bought the cheap one first — broke in a month. Bought the popular one everyone recommends — fine, but overpriced for what it does. This is the one I'd actually tell my brother to buy.",
        settings: { look: 'raw_iphone', duration: 20, aspect_ratio: '9:16', captions: true, caption_style: 'tiktok', product_image: '[placeholder]' },
      },
      {
        id: 'comparison-subscription',
        title: 'Service / subscription comparison',
        character: 'Harriet Solis',
        persona: 'late 20s, laptop open, analytical and quick-paced',
        script: "I ran the numbers on three of these before switching. Two of them nickel-and-dime you the second you go over a limit. This one just doesn't do that, so it's the one I kept.",
        settings: { look: 'commercial', duration: 15, aspect_ratio: '1:1', captions: true, caption_style: 'minimal' },
      },
      {
        id: 'comparison-old-vs-new',
        title: 'Old method vs. new product',
        character: 'Femi Adeyemi',
        persona: '40s, garage or driveway, practical tone',
        script: 'I did it the old way for fifteen years and swore by it. Then I tried this once and honestly felt a little dumb for waiting so long.',
        settings: { look: 'natural', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'hormozi', product_image: '[placeholder]' },
      },
    ],
  },
  {
    key: 'product_in_hands',
    label: 'Product-in-Hands Demo',
    emoji: '🤲',
    skill: 'make_product_in_hands',
    description: "Uses make_product_in_hands instead of make_ugc — a close-up visual demo of hands holding, opening, or turning a physical product. No script/voice; often paired with a testimonial as a b-roll cutaway.",
    categoryNote: "Pair either clip with a testimonial script from Product Testimonial / Review as a cutaway — drop it in as the broll_url on a make_ugc prompt so the talking character's voice plays over the product shot.",
    examples: [
      {
        id: 'product-in-hands-close-up',
        title: 'Close-up detail shot',
        notes: 'Showing texture, packaging detail, a button or dial, a label — anything worth lingering on for 2-3 seconds.',
        settings: { subject: 'a young woman', framing: 'close_up', product_image_url: '[placeholder — your product photo]' },
      },
      {
        id: 'product-in-hands-turn-around',
        title: 'Full turn-around',
        notes: 'Letting the viewer see the whole product from multiple angles — good for anything where shape or size matters (bottles, boxes, tools, apparel accessories).',
        settings: { subject: 'a man in his 30s', framing: 'full-body turn-around', product_image_url: '[placeholder]' },
      },
    ],
  },
  {
    key: 'podcast',
    label: 'Two-Person Conversation (Podcast style)',
    emoji: '🎙️',
    skill: 'make_podcast',
    description: "Uses make_podcast — two characters trading lines like a casual interview or friend-to-friend chat. Feels less like an ad because it's overheard rather than delivered to camera.",
    examples: [
      {
        id: 'podcast-friend-recommends',
        title: 'Friend recommends a product',
        character: 'A: Talia Brooks (curious, asking) · B: Reggie Munoz (already using the product)',
        turns: [
          { speaker: 'A', line: 'Okay wait, you actually stopped using the other one? Why?' },
          { speaker: 'B', line: "It kept syncing wrong and I'd lose half my notes. This one just... doesn't do that." },
          { speaker: 'A', line: "That's it? That's the whole pitch?" },
          { speaker: 'B', line: 'Honestly? Yeah. I just want things to work.' },
        ],
        settings: { room: 'casual living room or kitchen' },
      },
      {
        id: 'podcast-mini-interview',
        title: 'Mini interview / Q&A',
        character: 'A: Devon Ashworth (host) · B: Priya Nandan ("expert"/founder)',
        turns: [
          { speaker: 'A', line: "What's the one thing people get wrong when they try this themselves?" },
          { speaker: 'B', line: 'They skip the prep step, then wonder why it doesn\'t hold. Ninety percent of the result is in that first two minutes.' },
          { speaker: 'A', line: 'So if someone only remembers one thing from this video?' },
          { speaker: 'B', line: "Don't skip the prep step." },
        ],
        settings: { room: 'studio-style seated setup' },
      },
    ],
  },
  {
    key: 'broll_review',
    label: 'B-Roll Narrated Review',
    emoji: '🎬',
    skill: 'make_ugc',
    description: "Still uses make_ugc, but structures the script so the character delivers a short intro to camera, then narration that keeps playing while b-roll footage takes over the screen.",
    categoryNote: 'Script convention: an intro line, then a line containing only "---", then the narration — the actor delivers the intro on camera, then b-roll plays through the narration continuously.',
    examples: [
      {
        id: 'broll-review-home-product',
        title: 'Home product in use',
        character: 'Wren Castillo',
        persona: '30s, standing in living room for the intro line only',
        introLine: "You're going to want to see this in action, not just hear me talk about it.",
        narrationLine: "I run this every morning before anyone else is up. It's quiet enough that it doesn't wake the house, and by the time I'm making coffee the whole downstairs is done.",
        settings: { look: 'natural', duration: 20, aspect_ratio: '9:16', captions: true, caption_style: 'minimal', broll_url: '[placeholder — your product-in-use footage]' },
      },
      {
        id: 'broll-review-apparel',
        title: 'Apparel / accessory in motion',
        character: 'Isla Park',
        persona: '20s, standing outdoors for the intro line only',
        introLine: "I've worn this every single day for a month, so let me actually show you why.",
        narrationLine: "It doesn't shift when I move, the strap doesn't dig in after hours, and it still looks this clean after being through rain twice. That's the whole review.",
        settings: { look: 'raw_iphone', duration: 15, aspect_ratio: '9:16', captions: true, caption_style: 'tiktok', broll_url: '[placeholder]' },
      },
    ],
  },
  {
    key: 'storybook',
    label: 'Illustrated Brand Story (Storybook style)',
    emoji: '📖',
    skill: 'make_storybook',
    description: 'Uses make_storybook — an animated, illustrated sequence with named characters delivering lines over a series of scenes. Good for origin stories, kids\' or lifestyle brands, or any pitch that benefits from a warmer, less literal look than live-action.',
    examples: [
      {
        id: 'storybook-brand-origin',
        title: 'Brand origin story, 3 scenes',
        character: 'Nora (the founder, illustrated) · Gus (her dog, non-speaking but present in every scene)',
        artStyle: 'soft watercolor, warm palette',
        scenes: [
          { speaker: 'Nora', visual: 'a small kitchen table covered in notes and a laptop, late at night', line: "It started because I couldn't find one that actually worked for us." },
          { speaker: 'Nora', visual: 'boxes stacked in a hallway, Gus asleep on top of one', line: 'The first hundred orders shipped out of this hallway. Gus supervised.' },
          { speaker: 'Nora', visual: 'a small storefront with the sign going up', line: "Three years later, we're still doing it the same way — just with a door now." },
        ],
      },
      {
        id: 'storybook-simple-explainer',
        title: 'Simple explainer, 2 scenes',
        character: 'Theo (a customer, illustrated) · Pip (a friendly mascot-style guide)',
        artStyle: 'flat vector, bright colors',
        scenes: [
          { speaker: 'Theo', visual: 'Theo looking overwhelmed at a cluttered desk', line: 'I had twelve tabs open just trying to get this done.' },
          { speaker: 'Pip', visual: 'Pip pointing at a single clean screen', line: 'Or you could just start here. One place, one click.' },
        ],
      },
    ],
  },
  {
    key: 'storybook_cartoon',
    label: 'Storybook Examples (Cartoon Characters)',
    emoji: '🎨',
    skill: 'make_storybook',
    description: 'Also uses make_storybook, but pushed toward bold, exaggerated cartoon art instead of soft illustration — thick outlines, big expressions, saturated color. Good for playful, younger-skewing, or high-energy brands.',
    examples: [
      {
        id: 'storybook-cartoon-mascot',
        title: 'Mascot-led product intro, 3 scenes',
        character: "Bolt (a cartoon mascot, the brand's face) · Zoe (a cartoon kid customer)",
        artStyle: 'bold cartoon, thick outlines, saturated colors',
        scenes: [
          { speaker: 'Zoe', visual: 'Zoe staring at a messy desk, arms crossed, cartoon sweat drop', line: 'Ugh, not again. Where did I even put it this time?' },
          { speaker: 'Bolt', visual: 'Bolt bursting in from off-screen with a big cartoon pose', line: "That's exactly why I exist! Clip me on and you'll never ask that again." },
          { speaker: 'Zoe', visual: 'Zoe grinning, giving a thumbs up, Bolt beside her', line: "Okay, I'm sold. Never losing this thing again." },
        ],
      },
      {
        id: 'storybook-cartoon-skit',
        title: 'Silly problem/solution skit, 2 scenes',
        character: 'Chomp (a grumpy cartoon dog) · Winnie (his cartoon owner)',
        artStyle: 'retro Saturday-morning cartoon, halftone shading',
        scenes: [
          { speaker: 'Winnie', visual: 'Winnie chasing Chomp around a cartoon kitchen, chaos lines everywhere', line: 'Chomp, we are not doing this every single morning!' },
          { speaker: 'Winnie', visual: 'Chomp sitting calmly still, sparkle effects around the product', line: '...okay, THIS I could get used to.' },
        ],
      },
    ],
  },
];

/**
 * Turns a library example into an editable draft chat message — same
 * philosophy as the agent page's own promptToDraftMessage() for saved
 * prompts: it never auto-sends, and it always calls out that the
 * character is a placeholder that needs swapping for a real saved one
 * before the user hits send.
 */
export function promptExampleToDraftMessage(category: PromptExampleCategory, example: PromptExample): string {
  const lines: string[] = [];
  lines.push(`Run this example prompt "${category.label} — ${example.title}" with ${category.skill} (this is a placeholder character — swap it for one of my saved characters, or my own description, before you generate):`, '');

  if (example.character) {
    lines.push(`Character: [PLACEHOLDER] ${example.character}${example.persona ? ` — ${example.persona}` : ''}`);
  }

  if (example.script) {
    lines.push('', `Script: "${example.script}"`);
  } else if (example.introLine || example.narrationLine) {
    lines.push('', 'Script:', `"${example.introLine ?? ''}"`, '---', `"${example.narrationLine ?? ''}"`);
  } else if (example.turns?.length) {
    lines.push('', 'Script (alternating turns):');
    for (const t of example.turns) lines.push(`${t.speaker}: "${t.line}"`);
  } else if (example.scenes?.length) {
    if (example.artStyle) lines.push('', `Art style: ${example.artStyle}`);
    lines.push('', 'Scenes:');
    example.scenes.forEach((s, i) => lines.push(`${i + 1}. Speaker: ${s.speaker} — Visual: ${s.visual} — Line: "${s.line}"`));
  }

  if (example.notes) lines.push('', `Note: ${example.notes}`);

  if (example.settings && Object.keys(example.settings).length > 0) {
    lines.push('', Object.entries(example.settings).map(([k, v]) => `${k}: ${v}`).join(', '));
  }

  if (category.categoryNote) lines.push('', `Tip: ${category.categoryNote}`);

  return lines.join('\n');
}
