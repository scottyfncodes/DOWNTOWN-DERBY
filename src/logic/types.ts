export type GameState =
  | 'BOOT'
  | 'TITLE'
  | 'READY'
  | 'AIMING'
  | 'PITCHING'
  | 'SWINGING'
  | 'BALL_IN_FLIGHT'
  | 'SHOT_RESOLVING'
  | 'SHOT_RESULTS'
  | 'ROUND_COMPLETE'
  | 'GARAGE'
  | 'CHALLENGES'
  | 'SETTINGS';

export type ContactQuality = 'MISS' | 'WEAK' | 'POOR' | 'SOLID' | 'PERFECT';

export type MaterialKind =
  | 'glass'
  | 'sign'
  | 'billboard'
  | 'hvac'
  | 'crate'
  | 'barrel'
  | 'car'
  | 'streetlight'
  | 'watertower'
  | 'awning'
  | 'plank'
  | 'scaffold'
  | 'antenna'
  | 'concrete'
  | 'brick'
  | 'steel'
  | 'slab'
  | 'column'
  | 'rubble'
  | 'ground'
  | 'roof'
  | 'cage';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpinSetting {
  /** -1 = hook left, 0 = none, 1 = slice right */
  side: number;
  /** -1 = topspin, 0 = none, 1 = backspin */
  lift: number;
}

export interface AimSettings {
  /** yaw in radians, negative = left */
  yaw: number;
  /** launch angle in degrees */
  loft: number;
  spin: SpinSetting;
}

export interface SwingTiming {
  /** meter position at release, 0..1 */
  value: number;
  /** meter centre of the sweet zone, 0..1 */
  sweet: number;
  /** full width of the sweet zone, 0..1 */
  sweetWidth: number;
}

export interface ContactResult {
  quality: ContactQuality;
  /** signed timing error, negative = early */
  error: number;
  /** 0..1 power scale */
  power: number;
  /** additional yaw error (radians, signed) */
  yawError: number;
  /** additional loft (degrees, signed) */
  loftDelta: number;
}

export interface LaunchParams {
  velocity: Vec3;
  /** angular velocity in rad/s */
  spin: Vec3;
  speed: number;
  quality: ContactQuality;
}

export interface ImpactEvent {
  /** unique object id, or 'ground'/'building' style static tag */
  objectId: string;
  material: MaterialKind;
  /** relative impact speed in m/s */
  speed: number;
  /** true when the ball itself struck the object */
  direct: boolean;
  /** when the object was knocked down / detached / broken */
  destroyed: boolean;
  /** simulation time in seconds */
  time: number;
  /** world position of the impact */
  position: Vec3;
  /** bonus-target multiplier */
  bonusTarget?: boolean;
}

export interface ScoreLine {
  label: string;
  points: number;
  kind: 'impact' | 'bonus' | 'combo' | 'distance' | 'contact' | 'chain' | 'structure' | 'collapse' | 'detonation';
  material?: MaterialKind;
  position?: Vec3;
  combo?: number;
}

export interface ShotSummary {
  score: number;
  distance: number;
  quality: ContactQuality;
  objectsDamaged: number;
  chainCount: number;
  bestCombo: number;
  glassBroken: number;
  lines: ScoreLine[];
  uniqueMaterials: number;
  /** destructible building sections broken (facade cells, slabs, columns) */
  sectionsDestroyed: number;
  /** distinct destructible buildings damaged */
  buildingsDamaged: number;
  /** buildings that lost at least one floor to structural collapse */
  buildingsCollapsed: number;
  /** collapses triggered by debris from another collapse */
  chainCollapses: number;
  /** the rocket was detonated by the player (or self-destructed) */
  detonated: boolean;
}

export interface RoundSummary {
  total: number;
  bestShot: number;
  bestCombo: number;
  longestDistance: number;
  objectsDamaged: number;
  glassBroken: number;
  perfectContacts: number;
  sectionsDestroyed: number;
  buildingsCollapsed: number;
  chainCollapses: number;
  shots: ShotSummary[];
  isRecord: boolean;
  previousBest: number;
  creditsEarned: number;
  challengeCompleted: string | null;
  challengeReward: number;
}
