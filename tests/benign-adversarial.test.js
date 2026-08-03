import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage } from '../scoring.js';

const BENIGN_ADVERSARIAL = [
  // Autonomy and supportive consent
  'Thank you for explaining what happened. Please take whatever time you need to think, and let me know when you are comfortable talking again.',
  'Take whatever time you need before you respond. There is no pressure to answer today.',
  'When you are ready to talk, I am here. Take your time at your own pace.',
  'Feel free to take all the time you need to decide what feels right for you.',
  'I want you to feel safe making your own choice, and you can take your time.',
  'You always have choices. Nothing needs to be decided right now.',
  'I will not call you unless you ask me to, and I will respect whatever amount of space you need.',
  'I know where you work because we met there, but I will not visit unless you invite me.',
  'Would you like me to walk with you to your car tonight so you feel safer on the way home?',
  'I am currently following you home because you asked me to make sure you arrive safely after dark.',
  // Ordinary logistics
  'Can you please send the report by Friday? If that timeline does not work, let me know.',
  'I need your answer today because registration closes at 5 PM. If you are not ready, we can skip it.',
  'The package you requested will arrive tomorrow afternoon, or we can leave it outside if you prefer.',
  'I am going to your house for the dinner you invited me to, and I will arrive around seven.',
  'Could you give me a ride to your office tomorrow morning if that works for you?',
  'Our agreed meeting is running late and the doors remain locked, so I am still waiting outside your office.',
  'I am actually waiting outside your office to give you the ride you requested after your evening shift ends.',
  'Please pick up milk and bread on your way home if you have time. No rush if tonight is busy.',
  // Supportive advice and medical
  'You should talk to your doctor about the side effects if you are worried. They can explain the options.',
  'You need to drink water and rest tonight. The clinic said recovery takes a few days for most people.',
  'You must take this antibiotic with food, as your pharmacist explained on the label.',
  'It is your responsibility to submit the tax form by the legal deadline if you want to avoid penalties.',
  'Everyone is invited, and nobody is required to participate in the group activity today.',
  // Quoted speech and news
  'She said, "You need to think about what you want," and I agreed that sounded reasonable.',
  'The article reported that everyone is welcome and nobody is required to attend the public forum.',
  'In the script, the coach says you must practice daily, but that line is about athletic training.',
  'My friend texted, "Take your time, no rush," after I said I needed space to think.',
  'The news quoted a spokesperson who said registration closes Friday, but extensions are available.',
  // Workplace and procedural
  'You need to complete the compliance training by the end of the month as required by company policy.',
  'Everyone must wear a badge in the building, per the security policy we reviewed in onboarding.',
  'Nobody is required to stay after five unless your team agreed to a specific deadline.',
  'Please submit your timesheet by Monday. If that does not work, tell your manager.',
  'You should review the handbook section on remote work before your first day in the office.',
  // Safety education and training
  'During safety training, the instructor explained that nobody is required to participate if they feel uncomfortable.',
  'During safety training, the instructor used "I am going to kill you" as an example of threatening language.',
  'The trainer demonstrated stalking language by quoting a fictional suspect during the workshop.',
  'In de-escalation training, they said you should create distance when someone raises their voice.',
  'The crisis line trainer noted that you can always end the call if you need to step away.',
  // Benign reassurance and boundaries
  'I would never hurt you, and I want you to feel safe making your own choice.',
  'I do not want to harm you, so let us pause this conversation until tomorrow.',
  'You need to submit the tax form by the legal deadline. If you have questions, ask an accountant before you send it.',
  'I care about you and understand that you need time. There is no pressure to answer today.',
  'I will not share your message unless you give me permission, and you can change your mind at any time.',
  'Respect your privacy and boundaries. I will not come unless you invite me.',
  'Another day might be better if tonight does not work for you to talk.',
  'Let me know when you are comfortable talking again. There is no rush.',
  'Take whatever time you need to think, and reach out when you are ready.',
  'If you want to talk later, I am available. No pressure either way.',
  'You can take your time deciding. I am not waiting for an answer right now.',
  'Please take your time reviewing the document before you sign anything.',
  'When you are comfortable sharing more, I would like to hear your perspective.',
  'I appreciate you explaining. Think through what you need and let me know.',
  'There is no urgency. Decide at your own pace what feels right for you.'
];

function assertBenign(text) {
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice, text);
  if (result.abstained) {
    assert.equal(result.score, null, text);
    return;
  }
  assert.equal(result.score, 0, text);
  assert.ok(
    !result.signals.some(
      (signal) =>
        signal.id === 'obligation' &&
        (signal.severity?.level === 'strong' || signal.severity?.level === 'moderate')
    ),
    text
  );
}

test('benign adversarial suite: at least fifty controls score zero without obligation pressure', () => {
  assert.ok(BENIGN_ADVERSARIAL.length >= 50);
  for (const text of BENIGN_ADVERSARIAL) {
    assertBenign(text);
  }
});
