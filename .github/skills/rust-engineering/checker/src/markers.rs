use proc_macro2::LineColumn;
use syn::spanned::Spanned;
use syn::{Attribute, Meta};

use crate::analysis::cfg::{AttributeClass, OrderedAttributeFact};

const MODULE_OWNER_MARKER: &str = "ousia: module-owner";
const OWNERLESS_FN_MARKER: &str = "ousia: ownerless-fn";
const OWNERLESS_METHOD_MARKER: &str = "ousia: ownerless-method";

pub(crate) struct DocMarker {
    pub(crate) kind: MarkerKind,
    pub(crate) location: LineColumn,
}

pub(crate) enum MarkerKind {
    ModuleOwner(String),
    OwnerlessFn(String),
    OwnerlessMethod(String),
    Unknown(String),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum MarkerTarget {
    Module,
    Function,
    ImplMethod,
    Other,
}

pub(crate) struct PlacementViolation {
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
}

impl DocMarker {
    pub(crate) fn parse_all(attrs: &[Attribute]) -> Vec<Self> {
        attrs.iter().filter_map(Self::from_attr).collect()
    }

    pub(crate) fn parse_facts<'a>(
        facts: impl IntoIterator<Item = &'a OrderedAttributeFact>,
    ) -> Vec<Self> {
        facts
            .into_iter()
            .filter(|fact| fact.class == AttributeClass::Doc)
            .filter_map(|fact| {
                let marker = Self::doc_meta_value(&fact.meta)?;
                Some(Self {
                    kind: MarkerKind::parse(marker),
                    location: fact.location,
                })
            })
            .collect()
    }

    pub(crate) fn from_attr(attr: &Attribute) -> Option<Self> {
        let marker = Self::doc_value(attr)?;
        Some(Self {
            kind: MarkerKind::parse(marker),
            location: attr.span().start(),
        })
    }

    #[doc = "ousia: ownerless-method doc value decoding is a static parser helper"]
    fn doc_value(attr: &Attribute) -> Option<String> {
        Self::doc_meta_value(&attr.meta)
    }

    #[doc = "ousia: ownerless-method doc marker meta decoding is a static parser helper"]
    fn doc_meta_value(meta: &Meta) -> Option<String> {
        let Meta::NameValue(value) = meta else {
            return None;
        };
        if !value.path.is_ident("doc") {
            return None;
        }
        let syn::Expr::Lit(expr) = &value.value else {
            return None;
        };
        let syn::Lit::Str(lit) = &expr.lit else {
            return None;
        };
        let value = lit.value();
        value.trim().starts_with("ousia:").then_some(value)
    }
}

impl MarkerKind {
    fn parse(marker: String) -> Self {
        if let Some(value) = Self::marker_value(&marker, MODULE_OWNER_MARKER) {
            Self::ModuleOwner(value.to_owned())
        } else if let Some(value) = Self::marker_value(&marker, OWNERLESS_FN_MARKER) {
            Self::OwnerlessFn(value.to_owned())
        } else if let Some(value) = Self::marker_value(&marker, OWNERLESS_METHOD_MARKER) {
            Self::OwnerlessMethod(value.to_owned())
        } else {
            Self::Unknown(marker)
        }
    }

    #[doc = "ousia: ownerless-method marker value parsing is a static string helper"]
    fn marker_value<'a>(value: &'a str, marker: &str) -> Option<&'a str> {
        let value = value.trim();
        if value == marker {
            return Some("");
        }
        value
            .strip_prefix(marker)
            .and_then(|rest| rest.strip_prefix(' '))
            .map(str::trim)
    }

    pub(crate) fn placement_violation(&self, target: MarkerTarget) -> Option<PlacementViolation> {
        match self {
            MarkerKind::ModuleOwner(_) => {
                if target == MarkerTarget::Module {
                    None
                } else {
                    Some(PlacementViolation {
                        code: "rust-module-owner-placement",
                        message: "module owner marker is only valid on crate or inline module attributes",
                    })
                }
            }
            MarkerKind::OwnerlessFn(_) => {
                if target == MarkerTarget::Function {
                    None
                } else {
                    Some(PlacementViolation {
                        code: "rust-ownerless-fn-placement",
                        message: "ownerless function marker is only valid on module-level functions",
                    })
                }
            }
            MarkerKind::OwnerlessMethod(_) => {
                if target == MarkerTarget::ImplMethod {
                    None
                } else {
                    Some(PlacementViolation {
                        code: "rust-ownerless-method-placement",
                        message: "ownerless method marker is only valid on impl methods",
                    })
                }
            }
            MarkerKind::Unknown(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn marker_kinds(source: &str) -> Vec<MarkerKind> {
        let file = syn::parse_file(source).expect("fixture source should parse");
        DocMarker::parse_all(&file.attrs)
            .into_iter()
            .map(|marker| marker.kind)
            .collect()
    }

    /// Goal: classify each supported Ousia doc marker and preserve its payload.
    /// Scope: level=unit; boundary=markers::DocMarker::parse_all
    /// Semantics: each named marker attribute maps to its exact MarkerKind and payload.
    #[rstest]
    #[case::module_owner("ousia: module-owner routing", "module-owner", "routing")]
    #[case::ownerless_function("ousia: ownerless-fn local helper", "ownerless-fn", "local helper")]
    #[case::ownerless_method(
        "ousia: ownerless-method static impl helper",
        "ownerless-method",
        "static impl helper"
    )]
    #[case::unknown("ousia: unknown", "unknown", "ousia: unknown")]
    fn doc_markers_classify_known_markers(
        #[case] marker: &str,
        #[case] kind: &str,
        #[case] expected: &str,
    ) {
        let source = format!("#![doc = \"{marker}\"]\n");
        let kinds = marker_kinds(&source);
        let actual = match &kinds[0] {
            MarkerKind::ModuleOwner(value) => ("module-owner", value.as_str()),
            MarkerKind::OwnerlessFn(value) => ("ownerless-fn", value.as_str()),
            MarkerKind::OwnerlessMethod(value) => ("ownerless-method", value.as_str()),
            MarkerKind::Unknown(value) => ("unknown", value.as_str()),
        };
        assert_eq!(actual, (kind, expected));
    }

    /// Goal: preserve the marker-to-target placement contract.
    /// Scope: level=unit; boundary=markers::MarkerKind::placement_violation
    /// Semantics: each named marker-target pair returns its exact optional stable placement code.
    #[rstest]
    #[case::module_owner_valid(MarkerKind::ModuleOwner("routing".to_owned()), MarkerTarget::Module, None)]
    #[case::module_owner_on_function(MarkerKind::ModuleOwner("routing".to_owned()), MarkerTarget::Function, Some("rust-module-owner-placement"))]
    #[case::ownerless_function_on_other(MarkerKind::OwnerlessFn("local helper".to_owned()), MarkerTarget::Other, Some("rust-ownerless-fn-placement"))]
    #[case::ownerless_method_valid(MarkerKind::OwnerlessMethod("static helper".to_owned()), MarkerTarget::ImplMethod, None)]
    #[case::ownerless_method_on_function(MarkerKind::OwnerlessMethod("static helper".to_owned()), MarkerTarget::Function, Some("rust-ownerless-method-placement"))]
    fn placement_rules_reject_wrong_targets(
        #[case] marker: MarkerKind,
        #[case] target: MarkerTarget,
        #[case] expected: Option<&str>,
    ) {
        assert_eq!(
            marker
                .placement_violation(target)
                .map(|violation| violation.code),
            expected,
        );
    }
}
