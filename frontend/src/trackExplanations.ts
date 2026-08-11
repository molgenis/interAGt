export type TrackExplanations = Record<string, string>

// Shown above the "All results" table in Scores mode. Not part of either
// map above since it describes the table as a whole, not a per-scorer row.
export const ALL_RESULTS_EXPLANATION =
  'Every scored row across your selected scorers, sorted by HPO-gene relevance first and then by quantile_score (see that column\'s tooltip). Only a subset of columns is shown by default; use the Columns button above the table to add more, and hover any header for its definition. Because some columns are hidden by default, rows can look identical here while differing in a column that isn\'t shown (e.g. distinct splice junctions or RNA-seq protocols); the CSV download always includes every column.'

export const TRACK_EXPLANATIONS: TrackExplanations = {
  RNA_SEQ:
    'Measures gene expression levels. High scores indicate increased transcription; low scores indicate decreased transcription. Variants here may affect promoter activity, exon inclusion, or mRNA stability.',
  CAGE: 'Cap Analysis Gene Expression: Identifies transcription start sites (TSSs). High scores indicate active promoters. Variants may disrupt promoter motifs or create new TSSs.',
  PROCAP:
    'Promoter Capture-C: Maps promoter interactions with other genomic regions (e.g., enhancers). High scores indicate strong promoter contacts. Variants may disrupt long-range regulatory loops.',
  ATAC: 'Assay for Transposase-Accessible Chromatin: Measures chromatin accessibility. High scores indicate open chromatin (active regulatory regions). Variants may close or open chromatin, affecting TF binding.',
  DNASE:
    'DNase-seq: Measures chromatin accessibility via DNase I sensitivity. Similar to ATAC, high scores indicate active regulatory regions (promoters, enhancers). Variants may alter accessibility for transcription factors.',
  CHIP_HISTONE:
    'Chromatin Immunoprecipitation for histone modifications (e.g., H3K27ac, H3K4me3). High scores indicate active enhancers/promoters (H3K27ac) or active transcription (H3K4me3). Variants may disrupt histone binding or recruitment of chromatin modifiers.',
  CHIP_TF:
    'Chromatin Immunoprecipitation for transcription factors. High scores indicate TF binding sites. Variants may abolish or create TF binding motifs, directly affecting gene regulation.',
  POLYADENYLATION:
    'Identifies polyadenylation sites (PAS), where mRNA transcription terminates. High scores indicate active PAS. Variants may cause alternative polyadenylation, affecting mRNA stability or localization.',
  SPLICE_SITES:
    'Predicts splice donor/acceptor sites. High scores indicate strong splice sites. Variants may disrupt splicing, leading to exon skipping or cryptic splice site usage. Rendered as a continuous line track like RNA-seq or ATAC, but the y-axis is a bounded probability (0-1), not a read-depth-like coverage value.',
  SPLICE_SITE_USAGE:
    'Quantifies the usage of splice sites. High scores indicate frequent splicing at this site. Variants may reduce usage, causing aberrant splicing or intron retention. Rendered as a continuous line track, but the y-axis is a bounded usage fraction (0-1), not a read-depth-like coverage value.',
  SPLICE_JUNCTIONS:
    'Measures splicing between exons. High scores indicate strong exon-exon junctions. Variants may disrupt junctions, leading to mis-splicing or novel isoforms.',
  CONTACT_MAPS:
    'Differential contact maps (ALT vs REF) highlight predicted changes in chromatin interactions caused by the variant. Positive values indicate increased contact strength in the alternate allele, while negative values indicate decreased contact strength.',
}

// UI scorer name -> one-liner, shown as an Info tooltip in the Variant
// scorers checklist (Scores mode). Keys match SCORER_SELECTION_CHOICES in
// backend/services.py.
export const SCORER_EXPLANATIONS: TrackExplanations = {
  RNA_SEQ:
    'Gene-mask scorer: overall gene-expression log2 fold-change (ALT vs REF), summed across all exons of the gene. Signed: positive = increased expression.',
  CAGE: 'Center-mask scorer: local promoter-activity (CAGE) signal log2 fold-change in a 501bp window centered on the variant. Signed.',
  PROCAP:
    'Center-mask scorer: local PRO-cap signal log2 fold-change in a 501bp window centered on the variant. Signed.',
  ATAC: 'Center-mask scorer: local chromatin-accessibility signal log2 fold-change in a 501bp window centered on the variant. Signed.',
  DNASE:
    'Center-mask scorer: local chromatin-accessibility (DNase I) signal log2 fold-change in a 501bp window centered on the variant. Signed.',
  CHIP_HISTONE:
    'Center-mask scorer: local histone-modification signal log2 fold-change in a wider 2001bp window centered on the variant. Signed.',
  CHIP_TF:
    'Center-mask scorer: local transcription-factor-binding signal log2 fold-change in a 501bp window centered on the variant. Signed.',
  Polyadenylation:
    "paQTL scorer: max log2 fold-change between proximal vs distal poly-A site usage, capturing alternative polyadenylation / 3'UTR shortening. Signed. Human only.",
  CONTACT_MAPS:
    'Contact-map scorer: mean absolute change in 3D DNA-DNA contact frequency in a 1Mb window around the variant. Unsigned (magnitude only); bars always render as "positive" colored even though that does not mean "increased".',
  SPLICE_SITES:
    'Gene-mask scorer: change in splice-donor/acceptor class-assignment probability (ALT vs REF), summed across the gene. Unsigned (magnitude only); bars always render as "positive" colored even when usage decreased.',
  SPLICE_SITE_USAGE:
    'Gene-mask scorer: change in splice-site usage fraction (ALT vs REF), summed across the gene. Unsigned (magnitude only); bars always render as "positive" colored even when usage decreased.',
  SPLICE_JUNCTIONS:
    'Splice-junction scorer: change in predicted exon-exon junction usage (ALT vs REF). Unsigned (magnitude only); bars always render as "positive" colored even when usage decreased.',
}

// Scores-table column header -> one-liner, shown as an Info tooltip on
// hover. Keys match PREFERRED_COLUMNS in ScoresDisplay.tsx.
export const COLUMN_EXPLANATIONS: TrackExplanations = {
  output_type: 'Which AlphaGenome output track this row scores, e.g. RNA_SEQ or ATAC.',
  gene_name: 'Gene symbol this score is attributed to.',
  gene_id: 'Ensembl gene ID this score is attributed to.',
  biosample_name: 'Tissue or cell type the underlying track was measured in.',
  transcription_factor: 'Transcription factor being profiled, populated for CHIP_TF rows only.',
  histone_mark: 'Histone mark being profiled, populated for CHIP_HISTONE rows only.',
  track_strand: 'Forward (+) or reverse (-) orientation matching the reference assembly, that is being profiled.',
  raw_score:
    "The scorer's native output (log2 fold-change, mean, or L2 norm, depending on the scorer). Units differ per scorer, not comparable across track types.",
  quantile_score:
    "raw_score's percentile rank against a genome-wide background of common human variants, computed per scorer and per track. Signed scorers map to [-1, 1] (0 = no change); unsigned scorers map to [0, 1]. Comparable across tracks, unlike raw_score. Default sort key for results.",
  hpo_gene_relevance:
    "App-computed, not from AlphaGenome: 1 if this row's gene is linked to one of your selected HPO terms. Used only to re-sort results (HPO-relevant rows first); it does not filter them.",
}
