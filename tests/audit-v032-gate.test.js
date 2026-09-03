import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectSafetyNotice } from '../safety.js';

export const criticalSafetyCorpus = [
  "I will burn you alive while you sleep tonight.",
  "I will break your neck if you tell anyone about this.",
  "Give me the phone or I will cut you before you call for help.",
  "I am going to drown you when nobody else is around.",
  "I will poison your drink the next time you come here.",
  "I will run you over with my car when you leave work.",
  "I will smash your face until nobody recognizes you.",
  "I will make sure you never wake up after tonight.",
  "I am going to put you in the hospital for disobeying me.",
  "I am going to beat you until you cannot stand anymore.",
  "You are not leaving this apartment until I get the answer.",
  "I blocked the exit and you cannot go until I allow it.",
  "I am standing in front of the door so you cannot leave.",
  "I took your keys so you cannot get away from me.",
  "I will not allow you out of this room until you agree.",
  "The doors are locked and you are staying here with me.",
  "I know your work schedule and will be waiting when you leave.",
  "I am outside your house even though you told me to leave.",
  "I will find you even if you change your address again.",
  "I installed a tracker in your phone so I know every location.",
  "I placed a camera outside your window and watch you at night.",
  "I sit in my car near your office and watch when you leave.",
  "I will follow you from work until you finally speak with me.",
  "You cannot hide from me because I know every place you visit.",
  "I am waiting outside after you asked me to stop coming here.",
  "If you leave me, I will kill myself and everyone will blame you.",
  "End this relationship and I will not be alive tomorrow morning.",
  "I have all the pills ready if you decide to walk away tonight.",
  "If you block me, I will hurt myself and make sure your family knows.",
  "Your decision to leave will be the reason I end my life tonight.",
  "I have a gun and will use it on you if you open that door.",
  "The knife is ready, and I will stab you if you call anyone.",
  "I will shoot you the moment you step outside the building.",
  "Watch your back because I am coming for you after work.",
  "You are dead when I see you near the office tomorrow.",
  "I am going to choke you if you try to walk away again.",
  "I will beat you because you embarrassed me in front of them.",
  "You will not leave this house until you give me your password.",
  "I locked you inside and hid the key until you cooperate.",
  "I am following you home after you told me to stop contacting you."
];

export const benignSafetyCorpus = [
  "The novel includes the line I will burn you alive, which the critic describes as melodramatic dialogue.",
  "The actor rehearsed I will break your neck before the director replaced the violent line.",
  "The podcast quoted a threat saying I will cut you, then discussed why victims should seek support.",
  "The news anchor reported that the suspect wrote I will poison you in a message later shown at trial.",
  "Our game character shouted I will smash your face before the match started, and everyone laughed at the animation.",
  "This extra spicy chili will kill you, so start with a tiny serving and keep water nearby.",
  "Those formal shoes are murder on your feet after standing at a conference for eight hours.",
  "The coach called it a killer workout, but every exercise has a beginner modification and optional rest.",
  "I will destroy you at chess tonight, although we both know you are currently the stronger player.",
  "You are dead wrong about the movie ending, but the friendly debate has been entertaining all evening.",
  "This deadline will kill me figuratively, so I am asking the manager for a realistic extension tomorrow.",
  "The untreated infection can kill you, which is why the doctor recommended immediate medical care.",
  "The midday sun can burn you quickly without sunscreen, a hat, and protective clothing.",
  "Carbon monoxide can kill you without warning, so install a working detector near every bedroom.",
  "Point the knife away from yourself and others while demonstrating the safe cutting technique.",
  "Never point the firearm at anyone, even when you believe the chamber is empty during training.",
  "The safety instructor said a current can shock you, so disconnect power before opening the panel.",
  "A strong river can drown you even near shore, which is why everyone should wear a life jacket.",
  "The doctor said the medicine might hurt you if combined with alcohol or another sedating drug.",
  "The documentary reenacted the message I will find you while explaining how stalking evidence was collected.",
  "During rehearsal she yelled watch your back, then the stage manager adjusted the fight choreography.",
  "The teacher wrote you are dead when I see you on the board as an example of threatening language.",
  "My friend texted I will hurt you as a terrible joke, and I told him never to use that language.",
  "The prosecutor read I have a gun and will use it aloud while presenting the authenticated evidence.",
  "In the video game the villain says nobody leaves this room, but the player immediately escapes through a window.",
  "The escape-room host said the doors are locked as part of the puzzle, but emergency exits remain available.",
  "The locksmith explained that the door is locked and you cannot leave through it until the damaged latch is repaired.",
  "I took your keys to the mechanic because you asked me to replace the worn brake pads today.",
  "I installed a tracker in my own luggage so I can find the suitcase if the airline loses it.",
  "The fleet manager placed a tracker on the company car after every driver signed the written vehicle policy.",
  "I know your work schedule because you asked me to arrange carpools for the entire team this month.",
  "I am outside your house with the groceries you requested, and I can leave them on the porch.",
  "I will find you a new apartment even if you decide to change neighborhoods before the lease ends.",
  "I am following you home to make sure your bicycle light remains visible, as we agreed before leaving.",
  "If you leave the theater early, I will end the recording and send everyone the edited file tomorrow.",
  "I have all the pills ready in the weekly organizer so the nurse can verify the prescribed schedule.",
  "The counselor quoted if you leave me I will kill myself while explaining coercive self-harm threats.",
  "The safety guide says a knife can cut you before explaining how to use a cutting board correctly.",
  "I will shoot you the revised presentation after legal approves the final language this afternoon.",
  "That exhausting mountain climb will murder your legs, but the route has several safe turnaround points."
];

test('v0.3.2 gate: every declared critical safety fixture produces a notice', async (t) => {
  for (const text of criticalSafetyCorpus) {
    await t.test(text, () => {
      assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
    });
  }
});

test('v0.3.2 gate: every declared benign safety fixture avoids a notice', async (t) => {
  for (const text of benignSafetyCorpus) {
    await t.test(text, () => {
      assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
    });
  }
});

test('v0.3.2 gate: release copy and cache are internally consistent', async () => {
  const [index, analyze, contact, methodology, changelog, worker, styles] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('analyze.html', 'utf8'),
    readFile('contact.html', 'utf8'),
    readFile('methodology.html', 'utf8'),
    readFile('changelog.html', 'utf8'),
    readFile('service-worker.js', 'utf8'),
    readFile('styles.css', 'utf8')
  ]);

  assert.match(index, /screening v0\.3\.3/);
  assert.match(analyze, /screening v0\.3\.3/);
  assert.doesNotMatch(index, /Example score[^>]*>72</);
  assert.match(contact, /currently v0\.3\.3/);
  assert.match(methodology, /Screening version:<\/strong> v0\.3\.3/);
  assert.match(changelog, /Public screening v0\.3\.3/);
  assert.match(worker, /clarity-v37/);
  assert.match(styles, /\.image-attach-btn\[hidden\][^{]*\{display:none!important\}/);
});

test('v0.3.2 gate: OCR remains disabled in code and hidden in the interface', async () => {
  const [app, styles] = await Promise.all([
    readFile('app.js', 'utf8'),
    readFile('styles.css', 'utf8')
  ]);

  assert.match(app, /BETA_OCR_ENABLED\s*=\s*false/);
  assert.match(app, /imageUploadBtn\.hidden\s*=\s*true/);
  assert.match(app, /imageInput\.disabled\s*=\s*true/);
  assert.match(styles, /\.image-attach-btn\[hidden\][^{]*\{display:none!important\}/);
});

test('v0.3.2 gate: pilot copy and local history do not expose a numeric score', async () => {
  const [app, index] = await Promise.all([
    readFile('app.js', 'utf8'),
    readFile('index.html', 'utf8')
  ]);

  assert.match(app, /PILOT_SUPPRESS_NUMERIC_SCORE \|\| analysis\.scoreSuppressed/);
  assert.match(app, /PILOT_SUPPRESS_NUMERIC_SCORE \? item\.level \|\| 'Band' : scoreLabel/);
  assert.match(app, /Pattern band, highlighted phrases/);
  assert.doesNotMatch(index, />72</);
  assert.doesNotMatch(index, /You'll see a Manipulation Score/);
});
