import { TasteWheel } from './TasteWheel';
import { TasteChipCard } from './TasteChipCard';
import { StructuralGauges } from './StructuralGauges';

interface Note { note: string; intensity: 1 | 2 | 3; }

export type TasteProfile =
  | { schema_version: '2.0'; structure: 'tiered';
      tiers: { primary: Note[]; secondary: Note[]; tertiary: Note[] };
      structural: Record<string, string | null>;
      confidence: number; prompt_version: string; enriched_at: string; }
  | { schema_version: '2.0'; structure: 'flat';
      flat_tags: Note[];
      structural: Record<string, string | null>;
      confidence: number; prompt_version: string; enriched_at: string; };

interface Props { profile: TasteProfile | null; productId: string; }

export function TasteProfileSection({ profile, productId }: Props) {
  if (process.env.NEXT_PUBLIC_TASTE_PROFILE_ENABLED !== 'true') return null;
  if (!profile) return null;

  return (
    <section className="taste-profile-section" aria-labelledby={`taste-profile-${productId}`}>
      <h2 id={`taste-profile-${productId}`} className="taste-profile-heading">Taste Profile</h2>
      {profile.confidence < 0.5 && (
        <div className="taste-profile-confidence-badge">Preliminary tasting profile</div>
      )}
      {profile.structure === 'tiered' ? (
        <TasteWheel tiers={profile.tiers} />
      ) : (
        <TasteChipCard flatTags={profile.flat_tags} />
      )}
      <StructuralGauges structural={profile.structural} />
    </section>
  );
}
