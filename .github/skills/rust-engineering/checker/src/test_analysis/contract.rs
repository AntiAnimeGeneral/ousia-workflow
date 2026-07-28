use std::collections::BTreeMap;

use proc_macro2::LineColumn;
use syn::{Expr, Meta};

use crate::analysis::cfg::{AttributeClass, AttributeOrigin, OrderedAttributeFact};

use super::model::{ContractIssue, TestContract, TestIssueCode, TestScope};

impl TestContract {
    pub(super) fn from_facts(attrs: &[&OrderedAttributeFact], fallback: LineColumn) -> Self {
        let conditional_docs = attrs
            .iter()
            .filter(|attribute| {
                attribute.origin == AttributeOrigin::Conditional
                    && attribute.class == AttributeClass::Doc
            })
            .collect::<Vec<_>>();
        let docs = attrs
            .iter()
            .filter(|attribute| {
                attribute.origin == AttributeOrigin::Direct
                    && attribute.class == AttributeClass::Doc
            })
            .collect::<Vec<_>>();
        let mut issues = Vec::new();
        for attribute in conditional_docs {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractCarrierInvalid,
                attribute.location,
                "GSS doc attributes must be direct literal attributes",
            ));
        }
        let mut values = Vec::new();
        for attribute in &docs {
            let Meta::NameValue(meta) = &attribute.meta else {
                issues.push(ContractIssue::at(
                    TestIssueCode::ContractCarrierInvalid,
                    attribute.location,
                    "GSS doc attributes must be literal strings",
                ));
                continue;
            };
            let Expr::Lit(expression) = &meta.value else {
                issues.push(ContractIssue::at(
                    TestIssueCode::ContractCarrierInvalid,
                    attribute.location,
                    "GSS doc attributes must be literal strings",
                ));
                continue;
            };
            let syn::Lit::Str(value) = &expression.lit else {
                issues.push(ContractIssue::at(
                    TestIssueCode::ContractCarrierInvalid,
                    attribute.location,
                    "GSS doc attributes must be literal strings",
                ));
                continue;
            };
            values.push((value.value().trim().to_owned(), attribute.location));
        }
        let mut field_counts = BTreeMap::<&str, usize>::new();
        for (value, location) in &values {
            let Some((prefix, _)) = value.split_once(':') else {
                continue;
            };
            let field = prefix.trim();
            if !matches!(field, "Goal" | "Scope" | "Semantics") {
                continue;
            }
            let count = field_counts.entry(field).or_default();
            *count += 1;
            if *count > 1 {
                issues.push(ContractIssue::at(
                    TestIssueCode::ContractDuplicateField,
                    *location,
                    format!("duplicate `{field}` field"),
                ));
            }
        }
        if docs.is_empty() {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractMissing,
                fallback,
                "Rust test is missing Goal, Scope, and Semantics doc attributes",
            ));
        } else if docs.len() != 3 || values.len() != 3 {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractCarrierInvalid,
                docs.first()
                    .map_or(fallback, |attribute| attribute.location),
                "Rust test must have exactly three literal GSS doc attributes",
            ));
        }
        let goal = Self::field(&values, 0, "Goal", &mut issues);
        let scope_text = Self::field(&values, 1, "Scope", &mut issues);
        let semantics = Self::field(&values, 2, "Semantics", &mut issues);
        let scope = Self::scope(
            scope_text.as_deref(),
            values.get(1).map_or(fallback, |item| item.1),
            &mut issues,
        );
        Self {
            status: if issues.is_empty() {
                "complete"
            } else {
                "invalid"
            },
            goal,
            scope,
            semantics,
            issues,
        }
    }

    #[doc = "ousia: ownerless-method GSS field decoding is a static parser helper"]
    fn field(
        values: &[(String, LineColumn)],
        index: usize,
        expected: &str,
        issues: &mut Vec<ContractIssue>,
    ) -> Option<String> {
        let (value, location) = values.get(index)?;
        let Some((prefix, content)) = value.split_once(':') else {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractFieldOrder,
                *location,
                format!("expected `{expected}: ...`"),
            ));
            return None;
        };
        if prefix.trim() != expected {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractFieldOrder,
                *location,
                format!("expected `{expected}` as field {}", index + 1),
            ));
            return None;
        }
        let content = content.trim();
        if content.is_empty() {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractEmptyField,
                *location,
                format!("{expected} must not be empty"),
            ));
            return None;
        }
        if matches!(
            content.to_ascii_lowercase().as_str(),
            "todo" | "tbd" | "n/a" | "..." | "<goal>" | "<scope>" | "<semantics>" | "placeholder"
        ) {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractPlaceholder,
                *location,
                format!("{expected} must not be a placeholder"),
            ));
        }
        Some(content.to_owned())
    }

    #[doc = "ousia: ownerless-method GSS scope decoding is a static parser helper"]
    fn scope(
        value: Option<&str>,
        location: LineColumn,
        issues: &mut Vec<ContractIssue>,
    ) -> TestScope {
        let Some(value) = value else {
            return TestScope {
                level: None,
                boundary: None,
            };
        };
        let parts = value.split(';').map(str::trim).collect::<Vec<_>>();
        if parts.len() != 2 {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractScopeInvalid,
                location,
                "Scope must be `level=<level>; boundary=<boundary>`",
            ));
            return TestScope {
                level: None,
                boundary: None,
            };
        }
        let level = parts[0].strip_prefix("level=").map(str::trim);
        let boundary = parts[1].strip_prefix("boundary=").map(str::trim);
        if !level.is_some_and(|level| {
            matches!(
                level,
                "unit" | "module" | "integration" | "contract" | "smoke"
            )
        }) || !boundary.is_some_and(|boundary| !boundary.is_empty())
        {
            issues.push(ContractIssue::at(
                TestIssueCode::ContractScopeInvalid,
                location,
                "Scope level or boundary is invalid",
            ));
        }
        TestScope {
            level: level.map(str::to_owned),
            boundary: boundary
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
        }
    }
}

impl ContractIssue {
    pub(super) fn at(
        code: TestIssueCode,
        location: LineColumn,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            category: code.category(),
            line: location.line,
            column: location.column + 1,
            message: message.into(),
            location,
        }
    }
}
