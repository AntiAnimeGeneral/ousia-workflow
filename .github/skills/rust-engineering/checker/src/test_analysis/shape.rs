use std::collections::BTreeSet;
use std::path::Path;

use quote::ToTokens;
use syn::parse::Parser;
use syn::punctuated::Punctuated;
use syn::spanned::Spanned;
use syn::{Expr, ItemFn, Meta, Token};

use crate::analysis::cfg::{
    AttributeClass, AttributeOrigin, CfgExpr, OrderedAttributeFact, TestCarrier, TestCarrierKind,
};
use crate::analysis::{AnalysisSession, FatalError};

use super::model::{
    AttributeSource, CapabilityGuard, ContractIssue, RstestAttributeFact, RstestCase, RstestFacts,
    TestCarrierFact, TestIssueCode,
};

impl TestCarrierFact {
    pub(super) fn from_carrier(carrier: &TestCarrier, item_guard: &CfgExpr) -> Self {
        Self {
            kind: match carrier.kind {
                TestCarrierKind::Test => "test",
                TestCarrierKind::Rstest => "rstest",
                TestCarrierKind::RuntimeTest => "runtime-test",
            },
            path: carrier.path.clone(),
            ordinal: carrier.ordinal + 1,
            binding: "template",
            source: AttributeSource {
                line: carrier.location.line,
                column: carrier.location.column + 1,
            },
            guard: carrier.guard.canonical(),
            activation: CfgExpr::all([item_guard.clone(), carrier.guard.clone()]).canonical(),
        }
    }
}

#[doc = "ousia: ownerless-fn test shape validation"]
pub(super) fn test_shape_issues(
    session: &AnalysisSession,
    function: &ItemFn,
    item_guard: &CfgExpr,
    carriers: &[TestCarrier],
    attributes: &[&OrderedAttributeFact],
    rstest: &RstestFacts,
) -> Result<Vec<ContractIssue>, FatalError> {
    let mut issues = Vec::new();
    for carrier in carriers {
        if !carrier.valid_shape {
            issues.push(ContractIssue::at(
                TestIssueCode::TestAttributeInvalid,
                carrier.location,
                "test carrier must be a path attribute",
            ));
        }
    }
    for attribute in attributes {
        if let Meta::List(list) = &attribute.meta
            && attribute
                .meta
                .path()
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "rstest")
        {
            let parser = Punctuated::<Meta, Token![,]>::parse_terminated;
            if parser
                .parse2(list.tokens.clone())
                .is_ok_and(|items| items.iter().any(|meta| meta.path().is_ident("case")))
            {
                issues.push(ContractIssue::at(
                    TestIssueCode::RstestCompactCaseUnsupported,
                    attribute.location,
                    "rstest compact cases are not supported",
                ));
            }
        }
    }
    for attribute in attributes {
        if attribute.origin == AttributeOrigin::Conditional
            && attribute.class == AttributeClass::RstestCase
        {
            issues.push(ContractIssue::at(
                TestIssueCode::RstestConditionalCaseUnsupported,
                attribute.location,
                "conditional rstest cases are not supported",
            ));
        }
    }
    let mut labels = BTreeSet::new();
    for case in &rstest.cases {
        let Some(label) = case.label.as_deref() else {
            issues.push(ContractIssue::at(
                TestIssueCode::RstestCaseLabelMissing,
                function.sig.ident.span().start(),
                "rstest cases must use semantic labels",
            ));
            continue;
        };
        if !labels.insert(label) {
            issues.push(ContractIssue::at(
                TestIssueCode::RstestCaseLabelDuplicate,
                function.sig.ident.span().start(),
                format!("duplicate rstest case label `{label}`"),
            ));
        }
    }
    let is_rstest = carriers
        .iter()
        .any(|carrier| carrier.kind == TestCarrierKind::Rstest);
    let has_capability = rstest
        .capability_guards
        .iter()
        .try_fold(false, |found, capability| {
            session
                .test_possible(&CfgExpr::all([
                    item_guard.clone(),
                    capability.guard.clone(),
                ]))
                .map(|possible| found || possible)
        })?;
    if is_rstest && rstest.cases.len() < 2 && !has_capability {
        issues.push(ContractIssue::at(
            TestIssueCode::RstestNoCapability,
            function.sig.ident.span().start(),
            "single-scenario rstest must use a real fixture or rstest capability",
        ));
    }

    for input in &function.sig.inputs {
        let syn::FnArg::Typed(parameter) = input else {
            continue;
        };
        for attribute in &parameter.attrs {
            if attribute.path().is_ident("values") {
                issues.push(ContractIssue::at(
                    TestIssueCode::RstestValuesForbidden,
                    attribute.span().start(),
                    "rstest values dimensions are forbidden; use named cases",
                ));
            }
            if attribute.path().is_ident("files") {
                issues.push(ContractIssue::at(
                    TestIssueCode::RstestFilesForbidden,
                    attribute.span().start(),
                    "rstest files dimensions are forbidden; use named cases",
                ));
            }
        }
    }
    issues.extend(ignore_issues(session, item_guard, attributes, rstest)?);
    Ok(issues)
}

#[doc = "ousia: ownerless-fn source test attribute inventory"]
pub(super) fn test_attributes(carriers: &[TestCarrier]) -> Vec<String> {
    let mut found = BTreeSet::new();
    for carrier in carriers {
        found.insert(if carrier.conditional {
            "cfg-attr-test".to_owned()
        } else {
            carrier.path.clone()
        });
    }
    found.into_iter().collect()
}

impl RstestFacts {
    pub(super) fn from_function(
        function: &ItemFn,
        path: &Path,
        attributes: &[&OrderedAttributeFact],
        rstest_activation: &CfgExpr,
    ) -> Result<Self, FatalError> {
        let mut cases = Vec::new();
        let mut capabilities = BTreeSet::new();
        let mut capability_guards = Vec::new();
        let case_ordinals = attributes
            .iter()
            .filter(|attribute| {
                attribute.origin == AttributeOrigin::Direct
                    && attribute.class == AttributeClass::RstestCase
            })
            .map(|attribute| attribute.source_ordinal)
            .collect::<Vec<_>>();
        let template_start = case_ordinals.last().map_or(0, |ordinal| ordinal + 1);
        let template_attributes =
            placement_attributes(attributes, template_start..usize::MAX, "template");
        for attribute in attributes {
            let segments = &attribute.meta.path().segments;
            if attribute.origin == AttributeOrigin::Direct
                && attribute.class == AttributeClass::RstestCase
            {
                cases.push(RstestCase {
                    label: if segments
                        .first()
                        .is_some_and(|segment| segment.ident == "case")
                    {
                        segments.get(1).map(|segment| segment.ident.to_string())
                    } else {
                        None
                    },
                    ordinal: cases.len() + 1,
                    activation: rstest_activation.canonical(),
                    attributes: case_attributes(
                        attributes,
                        &case_ordinals,
                        attribute.source_ordinal,
                    ),
                    effective_attributes: Vec::new(),
                });
            }
            let last = segments.last().map(|segment| segment.ident.to_string());
            if attribute.class == AttributeClass::RstestCase {
                continue;
            }
            match last.as_deref() {
                Some("trace") => {
                    capabilities.insert("trace");
                    capability_guards.push(CapabilityGuard {
                        name: "trace",
                        guard: CfgExpr::all([rstest_activation.clone(), attribute.guard.clone()]),
                    });
                }
                Some("timeout") => {
                    capabilities.insert("timeout");
                    capability_guards.push(CapabilityGuard {
                        name: "timeout",
                        guard: CfgExpr::all([rstest_activation.clone(), attribute.guard.clone()]),
                    });
                }
                Some("test_attr") => {
                    capabilities.insert("test-attr");
                    capability_guards.push(CapabilityGuard {
                        name: "test-attr",
                        guard: CfgExpr::all([rstest_activation.clone(), attribute.guard.clone()]),
                    });
                }
                _ => {}
            }
        }
        let mut fixture_parameters = BTreeSet::new();
        for input in &function.sig.inputs {
            let syn::FnArg::Typed(parameter) = input else {
                continue;
            };
            let attrs = &parameter.attrs;
            let projection =
                crate::analysis::cfg::CfgModel::syntax_projector().attributes(attrs, path)?;
            let parameter_guard = CfgExpr::all([rstest_activation.clone(), projection.item_guard]);
            let has_case = attrs
                .iter()
                .any(|attribute| attribute.path().is_ident("case"));
            let has_context = attrs
                .iter()
                .any(|attribute| attribute.path().is_ident("context"));
            if has_context {
                capabilities.insert("context");
                capability_guards.push(CapabilityGuard {
                    name: "context",
                    guard: parameter_guard.clone(),
                });
            }
            let parameterized = attrs.iter().any(|attribute| {
                attribute.path().is_ident("values") || attribute.path().is_ident("files")
            });
            let ignored_injection = attrs
                .iter()
                .any(|attribute| attribute.path().is_ident("ignore"));
            if !has_case
                && !has_context
                && !parameterized
                && !ignored_injection
                && let syn::Pat::Ident(pattern) = parameter.pat.as_ref()
            {
                fixture_parameters.insert(pattern.ident.to_string());
                capabilities.insert("fixture");
                capability_guards.push(CapabilityGuard {
                    name: "fixture",
                    guard: parameter_guard,
                });
            }
        }
        for case in &mut cases {
            case.effective_attributes = template_attributes
                .iter()
                .cloned()
                .chain(case.attributes.iter().cloned())
                .collect();
        }
        capability_guards.sort_by(|left, right| {
            left.name
                .cmp(right.name)
                .then_with(|| left.guard.cmp(&right.guard))
        });
        capability_guards
            .dedup_by(|left, right| left.name == right.name && left.guard == right.guard);
        Ok(Self {
            cases,
            template_attributes,
            fixture_parameters: fixture_parameters.into_iter().collect(),
            capabilities: capabilities.into_iter().collect(),
            capability_guards,
        })
    }
}

#[doc = "ousia: ownerless-fn rstest case attribute binding projection"]
fn case_attributes(
    attributes: &[&OrderedAttributeFact],
    case_ordinals: &[usize],
    case_ordinal: usize,
) -> Vec<RstestAttributeFact> {
    let previous_case = case_ordinals
        .iter()
        .copied()
        .take_while(|ordinal| *ordinal < case_ordinal)
        .last();
    let start = previous_case.map_or(0, |ordinal| ordinal + 1);
    placement_attributes(attributes, start..case_ordinal, "case")
}

#[doc = "ousia: ownerless-fn ordered rstest attribute placement projection"]
fn placement_attributes(
    attributes: &[&OrderedAttributeFact],
    ordinals: std::ops::Range<usize>,
    binding: &'static str,
) -> Vec<RstestAttributeFact> {
    attributes
        .iter()
        .filter(|attribute| {
            ordinals.contains(&attribute.source_ordinal)
                && is_rstest_case_attribute(&attribute.meta)
        })
        .map(|attribute| RstestAttributeFact {
            syntax: attribute.meta.to_token_stream().to_string(),
            binding,
            guard: attribute.guard.canonical(),
            source: AttributeSource {
                line: attribute.location.line,
                column: attribute.location.column + 1,
            },
        })
        .collect()
}

#[doc = "ousia: ownerless-fn rstest case-bound attribute classification"]
fn is_rstest_case_attribute(meta: &Meta) -> bool {
    !meta.path().is_ident("doc")
        && !meta.path().is_ident("rstest")
        && !is_case_meta(meta)
        && !meta.path().is_ident("cfg")
        && !meta.path().is_ident("cfg_attr")
}

#[doc = "ousia: ownerless-fn typed rstest case meta classification"]
fn is_case_meta(meta: &Meta) -> bool {
    meta.path()
        .segments
        .first()
        .is_some_and(|segment| segment.ident == "case")
}

#[doc = "ousia: ownerless-fn test-level ignore carrier validation"]
fn ignore_issues(
    session: &AnalysisSession,
    item_guard: &CfgExpr,
    attributes: &[&OrderedAttributeFact],
    rstest: &RstestFacts,
) -> Result<Vec<ContractIssue>, FatalError> {
    let ignores = attributes
        .iter()
        .filter(|attribute| attribute.class == AttributeClass::Ignore)
        .copied()
        .collect::<Vec<_>>();
    let mut issues = Vec::new();
    if rstest.cases.is_empty() {
        if let Some(duplicate) = first_overlapping_ignore(session, item_guard, &ignores)? {
            issues.push(ContractIssue::at(
                TestIssueCode::TestIgnoreReason,
                duplicate.location,
                "test-level ignore reason must be unique",
            ));
        }
    } else {
        let case_ordinals = attributes
            .iter()
            .filter(|attribute| {
                attribute.origin == AttributeOrigin::Direct
                    && attribute.class == AttributeClass::RstestCase
            })
            .map(|attribute| attribute.source_ordinal)
            .collect::<Vec<_>>();
        let template_start = case_ordinals.last().map_or(0, |ordinal| ordinal + 1);
        for (index, case_ordinal) in case_ordinals.iter().copied().enumerate() {
            let start = index
                .checked_sub(1)
                .map_or(0, |previous| case_ordinals[previous] + 1);
            let effective = ignores
                .iter()
                .filter(|attribute| {
                    (start..case_ordinal).contains(&attribute.source_ordinal)
                        || attribute.source_ordinal >= template_start
                })
                .copied()
                .collect::<Vec<_>>();
            if let Some(duplicate) = first_overlapping_ignore(session, item_guard, &effective)? {
                issues.push(ContractIssue::at(
                    TestIssueCode::TestIgnoreReason,
                    duplicate.location,
                    format!("rstest case {} has multiple ignore reasons", index + 1),
                ));
            }
        }
    }
    for attribute in ignores {
        let Meta::NameValue(meta) = &attribute.meta else {
            issues.push(ContractIssue::at(
                TestIssueCode::TestIgnoreReason,
                attribute.location,
                "test-level ignore must be `#[ignore = \"reason\"]`",
            ));
            continue;
        };
        let Expr::Lit(expression) = &meta.value else {
            issues.push(ContractIssue::at(
                TestIssueCode::TestIgnoreReason,
                attribute.location,
                "test-level ignore reason must be a literal string",
            ));
            continue;
        };
        let syn::Lit::Str(reason) = &expression.lit else {
            issues.push(ContractIssue::at(
                TestIssueCode::TestIgnoreReason,
                attribute.location,
                "test-level ignore reason must be a literal string",
            ));
            continue;
        };
        let reason = reason.value();
        if reason.trim().is_empty()
            || matches!(
                reason.trim().to_ascii_lowercase().as_str(),
                "todo"
                    | "tbd"
                    | "n/a"
                    | "..."
                    | "<goal>"
                    | "<scope>"
                    | "<semantics>"
                    | "placeholder"
            )
        {
            issues.push(ContractIssue::at(
                TestIssueCode::TestIgnoreReason,
                attribute.location,
                "test-level ignore reason must be meaningful",
            ));
        }
    }
    Ok(issues)
}

#[doc = "ousia: ownerless-fn effective ignore guard overlap projection"]
fn first_overlapping_ignore<'a>(
    session: &AnalysisSession,
    activation: &CfgExpr,
    ignores: &[&'a OrderedAttributeFact],
) -> Result<Option<&'a OrderedAttributeFact>, FatalError> {
    for (index, left) in ignores.iter().enumerate() {
        for right in &ignores[index + 1..] {
            let guard = CfgExpr::all([activation.clone(), left.guard.clone(), right.guard.clone()]);
            if session.test_possible(&guard)? {
                return Ok(Some(*right));
            }
        }
    }
    Ok(None)
}
