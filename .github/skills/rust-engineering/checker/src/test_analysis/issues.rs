use serde::Serialize;

use super::model::{IssueCategory, TestIssueCode};

impl TestIssueCode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::ContractMissing => "rust-test-contract-missing",
            Self::ContractFieldOrder => "rust-test-contract-field-order",
            Self::ContractDuplicateField => "rust-test-contract-duplicate-field",
            Self::ContractEmptyField => "rust-test-contract-empty-field",
            Self::ContractPlaceholder => "rust-test-contract-placeholder",
            Self::ContractScopeInvalid => "rust-test-contract-scope-invalid",
            Self::ContractCarrierInvalid => "rust-test-contract-carrier-invalid",
            Self::TestAttributeInvalid => "rust-test-attribute-invalid",
            Self::RstestNoCapability => "rust-rstest-no-capability",
            Self::RstestCaseLabelMissing => "rust-rstest-case-label-missing",
            Self::RstestCaseLabelDuplicate => "rust-rstest-case-label-duplicate",
            Self::RstestValuesForbidden => "rust-rstest-values-forbidden",
            Self::RstestFilesForbidden => "rust-rstest-files-forbidden",
            Self::RstestCompactCaseUnsupported => "rust-rstest-compact-case-unsupported",
            Self::RstestConditionalCaseUnsupported => "rust-rstest-conditional-case-unsupported",
            Self::TestIgnoreReason => "rust-test-ignore-reason",
        }
    }

    pub(super) fn category(self) -> IssueCategory {
        match self {
            Self::ContractMissing
            | Self::ContractFieldOrder
            | Self::ContractDuplicateField
            | Self::ContractEmptyField
            | Self::ContractPlaceholder
            | Self::ContractScopeInvalid
            | Self::ContractCarrierInvalid
            | Self::TestAttributeInvalid => IssueCategory::Contract,
            Self::RstestNoCapability
            | Self::RstestCaseLabelMissing
            | Self::RstestCaseLabelDuplicate
            | Self::RstestValuesForbidden
            | Self::RstestFilesForbidden
            | Self::RstestCompactCaseUnsupported
            | Self::RstestConditionalCaseUnsupported
            | Self::TestIgnoreReason => IssueCategory::Shape,
        }
    }
}

impl Serialize for TestIssueCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl std::fmt::Display for TestIssueCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Goal: keep test issue codes typed until the serialization boundary.
    /// Scope: level=unit; boundary=test_analysis::issues::TestIssueCode::serialize
    /// Semantics: the enum serializes to its stable wire code without a string-to-enum producer path.
    #[test]
    fn issue_code_serializes_to_stable_wire_value() {
        assert_eq!(
            serde_json::to_string(&TestIssueCode::ContractMissing).expect("serialize issue code"),
            "\"rust-test-contract-missing\"",
        );
    }
}
