# Clarity brand direction

Status: greenfield brand direction for the public website and analyzer shell  
Date: September 3, 2026

## Design read

This is a trust-critical public literacy site and private analyzer for people who are trying to understand a difficult message. It needs a quiet editorial utility language: emotionally steady, visually distinctive, and precise enough that the interface never turns a pattern into a verdict.

Design dials for this overhaul:

- Design variance: 7. The layout may be asymmetric and memorable, but it must remain legible and calm.
- Motion intensity: 3. Motion is reserved for feedback and orientation, not attention capture.
- Visual density: 4. The page has room to breathe, while the analyzer keeps evidence close to the input.

## Brand decision

### Front-facing name

**Clarity**

Clarity is the product people use. It is short, understandable, and points toward the intended outcome rather than the accusation implied by a score.

### Endorser

**Clarity by Manipulation Score**

Manipulation Score remains the project and platform name in the footer, metadata, legal pages, and repository identity. It should not dominate the first emotional moment of the product. The public interface leads with Clarity because the user is looking for room to think, not a judgment about another person.

This is a brand architecture decision, not a claim about trademark availability or search ownership.

### Category

Private communication literacy.

Clarity helps a person inspect observable language functions in a message they are authorized to review. It is not a person profiler, a safety detector, a diagnosis, a lie detector, or legal evidence.

## Strategic territory

### The space before the reply

The most important moment is not the result screen. It is the gap between receiving a message and reacting from inside its pressure. Clarity gives that gap a usable shape.

The brand should make the user feel:

- steadier, not alarmed;
- more observant, not more suspicious;
- respected, not managed;
- capable of choosing, not instructed what to do.

### Brand promise

**Make room to think before you answer.**

This is a promise about the experience, not about accuracy, safety, or a relationship outcome.

### Primary message

**You do not have to answer from inside the pressure.**

Supporting message:

**Look at what the words are doing. Keep the context. Choose what comes next.**

Descriptor:

**Private, on-device language literacy for difficult messages.**

## Audience and job

The primary user is an individual privately reviewing a message or conversation they are authorized to examine. They may feel confused, rushed, guilty, or unsure whether their reaction is reasonable. They need a grounded way to slow down and inspect language without surrendering judgment to a tool.

The first screen must answer three questions quickly:

1. Can I use this privately?
2. What will I actually see?
3. Can I start without learning a new system?

The primary actions are:

- Learn the language functions before pasting anything.
- Start a private review of a message.

## Message hierarchy

1. **Outcome:** Make room before you reply.
2. **Function:** See possible pressure patterns in the words.
3. **Boundary:** Clarity analyzes text, not people, intent, danger, or relationship truth.
4. **Privacy:** Core analysis runs in the browser. No account is required. History is off by default.
5. **Action:** Pause, understand, then choose your own response.

Do not lead with the numeric score. The band is a compact summary after evidence, not the product's identity.

## Voice

### Use

- sentence case;
- plain, concrete verbs;
- “may,” “possible,” and “in this text” when uncertainty matters;
- direct invitations such as “Look closer” and “Learn the patterns”;
- language that gives time back to the user.

### Avoid

- labels for the writer;
- claims of intent, abuse, danger, accuracy, or certainty;
- therapy-speak and moralizing;
- urgency, fear, outrage, or engagement bait;
- fake validation, testimonials, metrics, or social proof;
- slogans that imply the tool knows more than the user.

### Copy examples

Prefer “Possible guilt framing in this message” to “This person is manipulating you.”

Prefer “Take a closer look” to “Get your answer.”

Prefer “The words may narrow your room to choose” to “This message is toxic.”

## Visual thesis

### The pause field

The site is an ink-colored reading room. Evidence appears on warm paper inside it. A single signal-lime accent marks the place where the user can look closer or take action.

This creates a visual metaphor without pretending the interface can reveal hidden truth:

- ink is the quiet surrounding context;
- paper is the message or evidence under review;
- lime is attention, not danger;
- open margins represent time and agency.

### Palette

The page uses one primary accent. Safety states remain semantically distinct in the analyzer and are always labeled in text.

- Ink: `#0D1210`, page background and primary text field
- Ink surface: `#151D19`, elevated dark surface
- Ink raised: `#202B25`, secondary dark surface
- Paper: `#F4F1E8`, evidence and reading surface
- Paper soft: `#E7E8DF`, quiet surface and borders
- Text on ink: `#F4F1E8`
- Muted on ink: `#AEB9B0`
- Ink text on paper: `#152019`
- Signal lime: `#D7FF54`, primary action and selected attention
- Lime ink: `#1D290B`, text on signal lime
- Quiet line: `rgba(244, 241, 232, .16)`

No purple or multicolor AI gradient is used. No accent is used decoratively without a clear attention or action role.

### Type

Use the self-hosted fonts already in the repository:

- Manrope for display headings, navigation, and strong labels.
- DM Sans for body copy, long-form trust content, and analyzer text.

Use a compact semantic scale. Headings can be large, but body copy stays at readable sizes and capped measures. Emphasis uses weight or italic within the established family, not a random display serif.

### Shape and material

- Primary containers use a 14px radius.
- Controls use an 8px radius.
- Status tags may use a full pill when the shape communicates status.
- Borders and spacing carry more hierarchy than shadows.
- Shadows are tinted toward ink and used only where a paper evidence surface must lift from the field.
- Avoid cards for every paragraph. Use whitespace, rules, and aligned edges for related content.

## Experience architecture

Keep the existing route slugs so links, trust pages, and search indexing remain stable:

- Home: the pause field, the two starting paths, the product boundaries, and support resources.
- Learn: the twelve language functions and benign lookalikes.
- Analyze: the message input and evidence-linked result shell.
- Method: how screening works and where it stops.
- Privacy: what stays on the device and what local history means.
- Limitations, Acceptable Use, Accessibility, Contact, and Changelog: trust infrastructure.

The home page should make the next action visible in the first viewport. The analyzer should feel like a reading workspace, not a marketing page.

## Rejected directions

These are attractive but incompatible with the product doctrine:

- A person-level “manipulation score” as the hero promise.
- Alarm-red warnings for ordinary pattern matches.
- Public share cards, leaderboards, or named profiles.
- A cloud upload flow presented as the default.
- A diagnostic or therapeutic visual language.
- A generic SaaS bento grid, purple AI gradient, or decorative glass layer with no product role.
- Fake testimonials, accuracy numbers, partners, or validation claims.
- Motion that makes a result feel more certain.

## Acceptance tests

A future public-page change fits this direction when:

- the first viewport makes private use, the product's job, and the next action clear;
- the user can distinguish evidence from interpretation and interpretation from action;
- the brand feels calm without becoming bland;
- the page is visually recognizable without relying on a large slogan alone;
- the design works at narrow widths, with keyboard focus, and with reduced motion;
- the score never visually outranks the evidence and limitations;
- no new feature, data transfer, scoring rule, or safety claim is smuggled in as a design decision.
