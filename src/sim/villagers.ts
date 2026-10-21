// The people who keep the waystations at the ends of the forks (HOM-134): who they are and what they know.
//
// A villager is not a quest giver. They hold no stage, they take nothing and they give nothing but words: what this corner of
// the country is, what happened here, and which way the next town lies. That last part is the point of them — a player who has
// come out of a town and does not know which way to walk can ask the next person they meet, and the answer is a direction.
//
// Where they stand is sim/world.ts's (`wayKeeper`, beside the fork's shrine or fire), because the ground is world data and a
// villager is a collider like any other person. What they say lives here, beside the quest givers' lines in quest.ts.
import { BRANCHES, Pt, wayKeeper } from './world';

export interface Villager {
  /** The branch whose waystation they keep: the id a click or the talk key carries. */
  id: string;
  name: string;
  x: number;
  z: number;
  r: number;
  /** The lore: what they say when you stop. The last line is always the way on, so asking is never a dead end. */
  lines: string[];
  /** What the player can say back. One of them is always a question about the road. */
  asked: string;
  answer: string;
}

/** What each waystation's keeper knows, by their branch's id. */
const WORDS: Record<string, { name: string; lines: string[]; asked: string; answer: string }> = {
  weeping: {
    name: 'Pilgrim Osmund',
    lines: [
      'Rest a moment. The stone weeps whatever the weather does, and it has done it longer than Hale has stood.',
      'They say a carter\'s wife waited at this fork for a man who went east and never came back, and that the water is still her. I only know that the lamp wants filling and nobody else comes to fill it.',
      'Keep east along the road and you come to Saltmarrow, where the land runs out and the sea begins. West is Hale, and the clearing, and the cave they will not go near.',
    ],
    asked: 'Is the road east safe?',
    answer: 'Safe is a strong word. There is a toll camp halfway, and a man who calls himself a Captain running it, and wolves either side of that. Keep to the dirt and walk steadily: what lives off the road mostly stays off it.',
  },
  drovers: {
    name: 'Drover Hesk',
    lines: [
      'Mind the fire. I bring sheep up this road twice a year and this is where I stop both ways, so the kettle is usually on.',
      'There were four rests like this between Hale and the sea when I started. The Captain\'s lot burned two and the hogs rooted out the third. This is the last one, and I keep it.',
      'East is Saltmarrow: another hour\'s walk and you will smell it before you see it. Harbourmaster Pell keeps the quay, and Pell always has work.',
    ],
    asked: 'What is worth stopping for out here?',
    answer: 'The stands along the road, if you carry a pick. Tin and iron from the first one past Hale\'s gate, coal from the second, and the richest of them nearest the sea. Every drover I know pays for his winter with what he picks up walking.',
  },
  drowned: {
    name: 'Fenwife Alsa',
    lines: [
      'Stand on the slabs, not between them. The ground between is where the fen keeps what it takes.',
      'These stones were a road before the water came up, and the village they went to is under your feet. On a still night you can hear the bell, or you can believe you can, which comes to the same thing out here.',
      'South is Thornwick, under the wood. North is Saltmarrow and the gate the warden holds. There is nothing else in the fen but the stained ground, and I have told you about that.',
    ],
    asked: 'What is the stained ground?',
    answer: 'Withering. It is the colour of old brass and it kills what stands in it, you included. It is never on the road and never within ten paces of it, which is the whole reason there is a road. Walk the dirt and you will never touch it.',
  },
  watcher: {
    name: 'Gravewarden Tobbe',
    lines: [
      'Sit if you like. The fire is the point of the place: the dead out here do not come near a lit one, and I have tested that more thoroughly than I wanted to.',
      'Every mound you passed was somebody who mattered once. The downs were a kingdom, the kingdom lost, and what is left is nine hundred paces of graves and a road through the middle of them.',
      'East along the road is Highmoor, on the heath. West is Thornwick and the gate. Do not go off into the mounds at night, and do not open one.',
    ],
    asked: 'Who opened the barrows, then?',
    answer: 'Not me. Half of them stood open when I came, with torches burning at the mouths, and the torches have never gone out. Whoever lit them wanted the dead to find their way back in. Or out. Nobody agrees which.',
  },
  sunken: {
    name: 'Stonecutter Veth',
    lines: [
      'Careful of the lip. This one went down into itself a hundred years back and it is still going, a finger a year.',
      'I cut the kerbstones for the new graves in Highmoor, and I come out here to read the old ones. The carving on this mound is a name nobody can say any more, which is the only kind of immortality the downs hand out.',
      'Keep east and the heath starts: that is Highmoor, with a Steward who signs for the north road. Behind you is the whole length of the downs and then Thornwick.',
    ],
    asked: 'Is there anything in the ground worth digging?',
    answer: 'Stormiron, in four stands along the road, a dozen paces off the dirt and clear of every camp. It is the best metal between here and the wastes, and nothing guards it but the walk.',
  },
  ashwell: {
    name: 'Ash-picker Corrin',
    lines: [
      'The water is clean, whatever it looks like. The ash sits on top and the well is deeper than the ash.',
      'This was a farm. You can see the line of the wall under the drift if you stand where I am standing. Everything from here to the Spire was farm, before the night the Spire came apart and the sky put this down on all of it.',
      'North up the road is the Sundered Spire itself. South is Highmoor and the gate Corvin keeps. There is nothing either side of the road out here but ogres and the ash.',
    ],
    asked: 'What happened at the Spire?',
    answer: 'The Keeper there has been reading the answer off a door for eleven years, so I will not pretend to have it. What I know is that whatever did it is still shut in under the north wall, and that the ash fell the same night, and that nothing has grown here since.',
  },
};

/** Everyone at a waystation, in branch order. */
export const VILLAGERS: Villager[] = BRANCHES.filter(b => WORDS[b.id]).map(b => {
  const p: Pt = wayKeeper(b);
  return { id: b.id, ...WORDS[b.id], x: p.x, z: p.z, r: 0.55 };
});

export const villagerById = (id: string): Villager | undefined => VILLAGERS.find(v => v.id === id);
