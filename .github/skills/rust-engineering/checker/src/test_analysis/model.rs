use proc_macro2::LineColumn;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub(crate) struct TestContractInventory {
    pub(crate) schema_version: &'static str,
    pub(crate) report_kind: &'static str,
    pub(crate) subject: InventorySubject,
    pub(crate) analysis: InventoryAnalysis,
    pub(crate) capabilities: InventoryCapabilities,
    pub(crate) summary: InventorySummary,
    pub(crate) tests: Vec<TestEntry>,
    pub(crate) candidate_groups: Vec<CandidateGroup>,
    pub(crate) warnings: Vec<InventoryWarning>,
}

#[derive(Debug, Serialize)]
pub(crate) struct InventorySubject {
    pub(crate) roots: Vec<InventoryRoot>,
}

#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct InventoryRoot {
    pub(crate) root_id: String,
    pub(crate) kind: &'static str,
    pub(crate) path: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct InventoryAnalysis {
    pub(crate) universe_policy: &'static str,
    pub(crate) cfg_evaluation: &'static str,
    pub(crate) rustc_cfg_sha256: String,
    pub(crate) cfg_budget: CfgBudget,
    pub(crate) target_normalization: &'static str,
    pub(crate) path_normalization: &'static str,
    pub(crate) fingerprint_algorithm: &'static str,
}

#[derive(Debug, Serialize)]
pub(crate) struct CfgBudget {
    pub(crate) nodes_per_expression: usize,
    pub(crate) atoms_per_expression: usize,
    pub(crate) assignments_per_expression: usize,
    pub(crate) queries_per_session: usize,
}

#[derive(Debug, Serialize)]
pub(crate) struct InventoryCapabilities {
    pub(crate) source_ast: &'static str,
    pub(crate) macro_expansion: &'static str,
    pub(crate) runtime_inventory: &'static str,
    pub(crate) coverage: &'static str,
    pub(crate) mutation: &'static str,
}

#[derive(Debug, Default, Serialize)]
pub(crate) struct InventorySummary {
    pub(crate) tests: usize,
    pub(crate) contracts_complete: usize,
    pub(crate) contracts_invalid: usize,
    pub(crate) shapes_valid: usize,
    pub(crate) shapes_invalid: usize,
    pub(crate) plain_tests: usize,
    pub(crate) rstest_templates: usize,
    pub(crate) declared_cases: usize,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestEntry {
    pub(crate) test_id: String,
    pub(crate) occurrence_id: String,
    pub(crate) root_id: String,
    pub(crate) package: InventoryPackage,
    pub(crate) target: TestTarget,
    pub(crate) module: String,
    pub(crate) source: TestSource,
    pub(crate) name: String,
    pub(crate) template_kind: &'static str,
    pub(crate) test_attributes: Vec<String>,
    pub(crate) contract: TestContract,
    pub(crate) shape: TestShape,
    pub(crate) issues: Vec<ContractIssue>,
    pub(crate) facts: TestFacts,
    pub(crate) fingerprints: TestFingerprints,
    #[serde(skip)]
    pub(crate) diagnostic_path: PathBuf,
}

#[derive(Debug, Serialize)]
pub(crate) struct InventoryPackage {
    pub(crate) name: String,
    pub(crate) manifest: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestTarget {
    pub(crate) kind: &'static str,
    pub(crate) name: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestSource {
    pub(crate) path: String,
    pub(crate) line: usize,
    pub(crate) column: usize,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestContract {
    pub(crate) status: &'static str,
    pub(crate) goal: Option<String>,
    pub(crate) scope: TestScope,
    pub(crate) semantics: Option<String>,
    #[serde(skip)]
    pub(crate) issues: Vec<ContractIssue>,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestScope {
    pub(crate) level: Option<String>,
    pub(crate) boundary: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestShape {
    pub(crate) status: &'static str,
    pub(crate) carriers: Vec<TestCarrierFact>,
    pub(crate) rstest: RstestFacts,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestCarrierFact {
    pub(crate) kind: &'static str,
    pub(crate) path: String,
    pub(crate) ordinal: usize,
    pub(crate) binding: &'static str,
    pub(crate) source: AttributeSource,
    pub(crate) guard: String,
    pub(crate) activation: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct AttributeSource {
    pub(crate) line: usize,
    pub(crate) column: usize,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ContractIssue {
    #[serde(rename = "code")]
    pub(crate) code: TestIssueCode,
    #[serde(rename = "category")]
    pub(crate) category: IssueCategory,
    pub(crate) line: usize,
    pub(crate) column: usize,
    pub(crate) message: String,
    #[serde(skip)]
    pub(crate) location: LineColumn,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum IssueCategory {
    Contract,
    Shape,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum TestIssueCode {
    ContractMissing,
    ContractFieldOrder,
    ContractDuplicateField,
    ContractEmptyField,
    ContractPlaceholder,
    ContractScopeInvalid,
    ContractCarrierInvalid,
    TestAttributeInvalid,
    RstestNoCapability,
    RstestCaseLabelMissing,
    RstestCaseLabelDuplicate,
    RstestValuesForbidden,
    RstestFilesForbidden,
    RstestCompactCaseUnsupported,
    RstestConditionalCaseUnsupported,
    TestIgnoreReason,
}

#[derive(Debug, Serialize)]
pub(crate) struct RstestFacts {
    pub(crate) cases: Vec<RstestCase>,
    pub(crate) template_attributes: Vec<RstestAttributeFact>,
    pub(crate) fixture_parameters: Vec<String>,
    pub(crate) capabilities: Vec<&'static str>,
    #[serde(skip)]
    pub(crate) capability_guards: Vec<CapabilityGuard>,
}

#[derive(Debug)]
pub(crate) struct CapabilityGuard {
    pub(crate) name: &'static str,
    pub(crate) guard: crate::analysis::cfg::CfgExpr,
}

#[derive(Debug, Serialize)]
pub(crate) struct RstestCase {
    pub(crate) label: Option<String>,
    pub(crate) ordinal: usize,
    pub(crate) activation: String,
    pub(crate) attributes: Vec<RstestAttributeFact>,
    pub(crate) effective_attributes: Vec<RstestAttributeFact>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct RstestAttributeFact {
    pub(crate) syntax: String,
    pub(crate) binding: &'static str,
    pub(crate) guard: String,
    pub(crate) source: AttributeSource,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestFacts {
    pub(crate) direct_function_calls: Vec<String>,
    pub(crate) receiver_methods: Vec<String>,
    pub(crate) oracles: Vec<&'static str>,
    pub(crate) oracle_literals: Vec<OracleLiteral>,
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub(crate) struct OracleLiteral {
    pub(crate) oracle: &'static str,
    pub(crate) argument: usize,
    pub(crate) literal: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct TestFingerprints {
    pub(crate) exact_body_sha256: String,
    pub(crate) literal_normalized_sha256: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CandidateGroup {
    pub(crate) code: &'static str,
    pub(crate) confidence: &'static str,
    pub(crate) tests: Vec<String>,
    pub(crate) evidence: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct InventoryWarning {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}
