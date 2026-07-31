export type TrackExplanations = Record<string, string>

export const TRACK_EXPLANATIONS: TrackExplanations = {
  scores:
    'Results from variant scoring, sorted by raw_score and HPO - gene matching. Quantile scores are standardized, track-specific metric that maps a variant\'s raw predicted impact score to its percentile rank against a fixed background of approximately 350,000 common human SNPs.',
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
    'Predicts splice donor/acceptor sites. High scores indicate strong splice sites. Variants may disrupt splicing, leading to exon skipping or cryptic splice site usage.',
  SPLICE_SITE_USAGE:
    'Quantifies the usage of splice sites. High scores indicate frequent splicing at this site. Variants may reduce usage, causing aberrant splicing or intron retention.',
  SPLICE_JUNCTIONS:
    'Measures splicing between exons. High scores indicate strong exon-exon junctions. Variants may disrupt junctions, leading to mis-splicing or novel isoforms.',
  CONTACT_MAPS:
    'Differential contact maps (ALT vs REF) highlight predicted changes in chromatin interactions caused by the variant. Positive values indicate increased contact strength in the alternate allele, while negative values indicate decreased contact strength.',
}
