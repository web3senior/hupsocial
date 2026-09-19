'use client'

import {
  AirplaneTiltIcon,
  AtomIcon,
  BarbellIcon,
  BookOpenIcon,
  BrainIcon,
  CameraIcon,
  ChartLineUpIcon,
  CodeIcon,
  FilmSlateIcon,
  FlaskIcon,
  ForkKnifeIcon,
  GameControllerIcon,
  GraduationCapIcon,
  HeartbeatIcon,
  ImagesSquareIcon,
  MathOperationsIcon,
  MicrophoneIcon,
  MusicNotesIcon,
  NewspaperIcon,
  NotePencilIcon,
  PaletteIcon,
  PawPrintIcon,
  PenNibIcon,
  RocketLaunchIcon,
  SmileyIcon,
  SoccerBallIcon,
  SparkleIcon,
  TShirtIcon,
  TreeIcon,
  TrendUpIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'

// The glyph half of config/interestOptions.js, kept out of that file so it stays dependency-free
// for the API route to validate against — and named one by one rather than pulled off a barrel
// import, so a profile card does not ship the whole icon set.
//
// A slug with no entry falls back to a sparkle instead of drawing nothing: the catalogue can grow
// in a later build, and a card with a label and no icon reads as broken rather than as new.
const ICONS = {
  art: PaletteIcon,
  music: MusicNotesIcon,
  photography: CameraIcon,
  film: FilmSlateIcon,
  design: PenNibIcon,
  writing: NotePencilIcon,
  gaming: GameControllerIcon,
  sports: SoccerBallIcon,
  fitness: BarbellIcon,
  food: ForkKnifeIcon,
  travel: AirplaneTiltIcon,
  nature: TreeIcon,
  pets: PawPrintIcon,
  science: FlaskIcon,
  physics: AtomIcon,
  maths: MathOperationsIcon,
  space: RocketLaunchIcon,
  ai: BrainIcon,
  code: CodeIcon,
  defi: ChartLineUpIcon,
  trading: TrendUpIcon,
  nfts: ImagesSquareIcon,
  dao: UsersThreeIcon,
  memes: SmileyIcon,
  books: BookOpenIcon,
  podcasts: MicrophoneIcon,
  fashion: TShirtIcon,
  health: HeartbeatIcon,
  news: NewspaperIcon,
  learning: GraduationCapIcon,
}

export default function InterestIcon({ slug, size = 22, weight = 'duotone', className }) {
  const Glyph = ICONS[slug] || SparkleIcon

  return <Glyph size={size} weight={weight} className={className} aria-hidden="true" />
}
