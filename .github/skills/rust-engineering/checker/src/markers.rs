use proc_macro2::LineColumn;
use syn::spanned::Spanned;
use syn::{Attribute, Meta};

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
    #[doc = "ousia: ownerless-method marker collection delegates to per-attribute parser"]
    pub(crate) fn parse_all(attrs: &[Attribute]) -> Vec<Self> {
        attrs.iter().filter_map(Self::from_attr).collect()
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
        let Meta::NameValue(value) = &attr.meta else {
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

    fn marker_kinds(source: &str) -> Vec<MarkerKind> {
        let file = syn::parse_file(source).expect("fixture source should parse");
        DocMarker::parse_all(&file.attrs)
            .into_iter()
            .map(|marker| marker.kind)
            .collect()
    }

    #[test]
    fn doc_markers_classify_known_markers() {
        let kinds = marker_kinds(
            r#"#![doc = "ousia: module-owner routing"]
#![doc = "ousia: ownerless-fn local helper"]
    #![doc = "ousia: ownerless-method static impl helper"]
#![doc = "ousia: unknown"]
"#,
        );
        assert!(matches!(&kinds[0], MarkerKind::ModuleOwner(value) if value == "routing"));
        assert!(matches!(&kinds[1], MarkerKind::OwnerlessFn(value) if value == "local helper"));
        assert!(
            matches!(&kinds[2], MarkerKind::OwnerlessMethod(value) if value == "static impl helper")
        );
        assert!(matches!(&kinds[3], MarkerKind::Unknown(value) if value == "ousia: unknown"));
    }

    #[test]
    fn placement_rules_reject_wrong_targets() {
        assert!(
            MarkerKind::ModuleOwner("routing".to_owned())
                .placement_violation(MarkerTarget::Module)
                .is_none()
        );
        assert_eq!(
            MarkerKind::ModuleOwner("routing".to_owned())
                .placement_violation(MarkerTarget::Function)
                .map(|violation| violation.code),
            Some("rust-module-owner-placement"),
        );
        assert_eq!(
            MarkerKind::OwnerlessFn("local helper".to_owned())
                .placement_violation(MarkerTarget::Other)
                .map(|violation| violation.code),
            Some("rust-ownerless-fn-placement"),
        );
        assert!(
            MarkerKind::OwnerlessMethod("static helper".to_owned())
                .placement_violation(MarkerTarget::ImplMethod)
                .is_none()
        );
        assert_eq!(
            MarkerKind::OwnerlessMethod("static helper".to_owned())
                .placement_violation(MarkerTarget::Function)
                .map(|violation| violation.code),
            Some("rust-ownerless-method-placement"),
        );
    }
}
