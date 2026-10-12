export interface BatSpec {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** multiplies launch speed */
  power: number;
  /** multiplies sweet-zone width (timing forgiveness) */
  timingWindow: number;
  /** multiplies aim error from mistimed contact */
  spread: number;
  /** multiplies impact force/score contribution of the ball */
  impact: number;
  tags: { label: string; dir: 'up' | 'down' | 'flat' }[];
}

export interface BallSpec {
  id: string;
  name: string;
  desc: string;
  cost: number;
  speed: number;
  restitution: number;
  /** multiplies mass (heavier balls shove props harder) */
  mass: number;
  /** multiplies Magnus (curve) effect */
  curve: number;
  /** multiplies damage score of direct hits */
  impact: number;
  color: number;
  tags: { label: string; dir: 'up' | 'down' | 'flat' }[];
}

export const BATS: BatSpec[] = [
  {
    id: 'balanced',
    name: 'Rooftop Classic',
    desc: 'The all-rounder. Honest power, honest timing.',
    cost: 0,
    power: 1,
    timingWindow: 1,
    spread: 1,
    impact: 1,
    tags: [{ label: 'Balanced', dir: 'flat' }],
  },
  {
    id: 'precision',
    name: 'Surveyor',
    desc: 'Wide sweet spot and tight aim. Slightly less pop. Built for bank shots.',
    cost: 1200,
    power: 0.94,
    timingWindow: 1.45,
    spread: 0.5,
    impact: 1,
    tags: [
      { label: 'Timing +45%', dir: 'up' },
      { label: 'Accuracy +50%', dir: 'up' },
      { label: 'Power -6%', dir: 'down' },
    ],
  },
  {
    id: 'slugger',
    name: 'Skyline Slugger',
    desc: 'Big barrel, big exit velocity. Narrow timing window punishes lazy swings.',
    cost: 1800,
    power: 1.14,
    timingWindow: 0.75,
    spread: 1.2,
    impact: 1.15,
    tags: [
      { label: 'Power +14%', dir: 'up' },
      { label: 'Impact +15%', dir: 'up' },
      { label: 'Timing -25%', dir: 'down' },
    ],
  },
  {
    id: 'titan',
    name: 'Demolition Titan',
    desc: 'Forged for wrecking. Enormous impact force, but the window is razor thin and misses spray wildly.',
    cost: 4200,
    power: 1.22,
    timingWindow: 0.55,
    spread: 1.6,
    impact: 1.4,
    tags: [
      { label: 'Power +22%', dir: 'up' },
      { label: 'Impact +40%', dir: 'up' },
      { label: 'Timing -45%', dir: 'down' },
      { label: 'Accuracy -60%', dir: 'down' },
    ],
  },
];

export const BALLS: BallSpec[] = [
  {
    id: 'standard',
    name: 'League Ball',
    desc: 'Regulation cork and leather. Predictable flight.',
    cost: 0,
    speed: 1,
    restitution: 0.52,
    mass: 1,
    curve: 1,
    impact: 1,
    color: 0xfff6e6,
    tags: [{ label: 'Standard', dir: 'flat' }],
  },
  {
    id: 'bouncer',
    name: 'Super Bouncer',
    desc: 'Rubber core keeps it ricocheting. Lives for chain reactions, dies on long carries.',
    cost: 1000,
    speed: 0.93,
    restitution: 0.88,
    mass: 0.8,
    curve: 1,
    impact: 0.9,
    color: 0x4ee6b0,
    tags: [
      { label: 'Bounce +70%', dir: 'up' },
      { label: 'Speed -7%', dir: 'down' },
    ],
  },
  {
    id: 'wrecker',
    name: 'Wrecking Ball',
    desc: 'Dense steel core. Slower off the bat, barely bounces, but it shoves whatever it meets.',
    cost: 2600,
    speed: 0.84,
    restitution: 0.3,
    mass: 3.2,
    curve: 0.6,
    impact: 1.7,
    color: 0x6b7280,
    tags: [
      { label: 'Impact +70%', dir: 'up' },
      { label: 'Mass x3', dir: 'up' },
      { label: 'Speed -16%', dir: 'down' },
      { label: 'Bounce -40%', dir: 'down' },
    ],
  },
  {
    id: 'curve',
    name: 'Screwball',
    desc: 'Raised seams catch the air. Spin bends the flight hard. Pair with the spin controls.',
    cost: 1800,
    speed: 0.98,
    restitution: 0.55,
    mass: 1,
    curve: 3.2,
    impact: 1,
    color: 0xff6b4a,
    tags: [
      { label: 'Curve x3', dir: 'up' },
      { label: 'Speed -2%', dir: 'down' },
    ],
  },
];

export function getBat(id: string): BatSpec {
  return BATS.find((b) => b.id === id) ?? BATS[0];
}
export function getBall(id: string): BallSpec {
  return BALLS.find((b) => b.id === id) ?? BALLS[0];
}
