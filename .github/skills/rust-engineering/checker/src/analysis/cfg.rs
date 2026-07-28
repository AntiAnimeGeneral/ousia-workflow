use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use proc_macro2::LineColumn;
use quote::ToTokens;
use sha2::{Digest, Sha256};
use syn::parse::Parser;
use syn::punctuated::Punctuated;
use syn::spanned::Spanned;
use syn::{Attribute, Meta, Token};

use super::error::{FatalError, FatalPhase};

const NODES_PER_EXPRESSION: usize = 256;
const ATOMS_PER_EXPRESSION: usize = 16;
const ASSIGNMENTS_PER_EXPRESSION: usize = 65_536;
const QUERIES_PER_SESSION: usize = 100_000;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum CfgExpr {
    True,
    False,
    Atom(String),
    Not(Box<CfgExpr>),
    All(Vec<CfgExpr>),
    Any(Vec<CfgExpr>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Universe {
    Production,
    Test,
}

#[derive(Clone, Debug)]
pub(crate) struct CfgEnvironment {
    enabled: BTreeSet<String>,
    digest: String,
}

pub(crate) struct CfgModel {
    environment: CfgEnvironment,
    memo: RefCell<BTreeMap<(Universe, CfgExpr), bool>>,
    queries: Cell<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CfgBudgetSnapshot {
    pub(crate) nodes_per_expression: usize,
    pub(crate) atoms_per_expression: usize,
    pub(crate) assignments_per_expression: usize,
    pub(crate) queries_per_session: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TestCarrierKind {
    Test,
    Rstest,
    RuntimeTest,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TestCarrier {
    pub(crate) kind: TestCarrierKind,
    pub(crate) path: String,
    pub(crate) ordinal: usize,
    pub(crate) guard: CfgExpr,
    pub(crate) location: LineColumn,
    pub(crate) conditional: bool,
    pub(crate) valid_shape: bool,
}

#[derive(Clone)]
pub(crate) struct AttributeProjection {
    pub(crate) item_guard: CfgExpr,
    pub(crate) ordered: Vec<OrderedAttributeFact>,
    pub(crate) path_alternatives: Vec<(CfgExpr, String)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum AttributeOrigin {
    Direct,
    Conditional,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AttributeClass {
    Cfg,
    CfgAttr,
    Doc,
    Path,
    Derive,
    TestLike,
    RstestCase,
    Ignore,
    Other,
}

#[derive(Clone)]
pub(crate) struct OrderedAttributeFact {
    pub(crate) meta: Meta,
    pub(crate) source_ordinal: usize,
    pub(crate) conditional_path: Vec<usize>,
    pub(crate) guard: CfgExpr,
    pub(crate) location: LineColumn,
    pub(crate) origin: AttributeOrigin,
    pub(crate) class: AttributeClass,
}

impl CfgEnvironment {
    fn empty() -> Self {
        Self {
            enabled: BTreeSet::new(),
            digest: String::new(),
        }
    }

    pub(crate) fn discover() -> Result<Self, FatalError> {
        let output = std::process::Command::new("rustc")
            .args(["--print", "cfg"])
            .output()
            .map_err(|error| {
                FatalError::new(
                    FatalPhase::CfgEnvironment,
                    "rustc-cfg-unavailable",
                    error.to_string(),
                )
            })?;
        if !output.status.success() {
            return Err(FatalError::new(
                FatalPhase::CfgEnvironment,
                "rustc-cfg-failed",
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        let stdout = String::from_utf8(output.stdout).map_err(|error| {
            FatalError::new(
                FatalPhase::CfgEnvironment,
                "rustc-cfg-invalid-utf8",
                error.to_string(),
            )
        })?;
        let enabled = stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect();
        let digest = format!("{:x}", Sha256::digest(stdout.as_bytes()));
        Ok(Self { enabled, digest })
    }

    #[cfg(test)]
    pub(crate) fn fixture(enabled: &[&str]) -> Self {
        let enabled = enabled.iter().map(|value| (*value).to_owned()).collect();
        Self {
            enabled,
            digest: "fixture".to_owned(),
        }
    }

    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }

    fn value(&self, atom: &str, universe: Universe) -> Option<bool> {
        if atom == "test" {
            return Some(universe == Universe::Test);
        }
        if is_platform_atom(atom) {
            return Some(self.enabled.contains(atom));
        }
        None
    }
}

impl CfgModel {
    pub(crate) fn new(environment: CfgEnvironment) -> Self {
        Self {
            environment,
            memo: RefCell::new(BTreeMap::new()),
            queries: Cell::new(0),
        }
    }

    pub(crate) fn syntax_projector() -> Self {
        Self::new(CfgEnvironment::empty())
    }

    pub(crate) fn environment(&self) -> &CfgEnvironment {
        &self.environment
    }

    pub(crate) fn budget(&self) -> CfgBudgetSnapshot {
        CfgBudgetSnapshot {
            nodes_per_expression: NODES_PER_EXPRESSION,
            atoms_per_expression: ATOMS_PER_EXPRESSION,
            assignments_per_expression: ASSIGNMENTS_PER_EXPRESSION,
            queries_per_session: QUERIES_PER_SESSION,
        }
    }

    pub(crate) fn attributes(
        &self,
        attrs: &[Attribute],
        path: &Path,
    ) -> Result<AttributeProjection, FatalError> {
        let mut projection = AttributeProjection {
            item_guard: CfgExpr::True,
            ordered: Vec::new(),
            path_alternatives: Vec::new(),
        };
        for (ordinal, attribute) in attrs.iter().enumerate() {
            projection.ordered.push(OrderedAttributeFact {
                meta: attribute.meta.clone(),
                source_ordinal: ordinal,
                conditional_path: Vec::new(),
                guard: CfgExpr::True,
                location: attribute.span().start(),
                origin: AttributeOrigin::Direct,
                class: classify_attribute(&attribute.meta),
            });
            if attribute.path().is_ident("cfg") {
                projection.item_guard =
                    CfgExpr::all([projection.item_guard, parse_cfg_attribute(attribute, path)?]);
                continue;
            }
            if attribute.path().is_ident("cfg_attr") {
                project_cfg_attr(
                    attribute,
                    CfgExpr::True,
                    ordinal,
                    Vec::new(),
                    path,
                    &mut projection,
                )?;
                continue;
            }
            if let Some(value) = path_value(&attribute.meta) {
                projection.path_alternatives.push((CfgExpr::True, value));
            }
        }
        Ok(projection)
    }

    pub(crate) fn possible(
        &self,
        expression: &CfgExpr,
        universe: Universe,
    ) -> Result<bool, FatalError> {
        let normalized = expression.clone().normalize();
        if let Some(result) = self.memo.borrow().get(&(universe, normalized.clone())) {
            return Ok(*result);
        }
        let queries = self.queries.get() + 1;
        self.queries.set(queries);
        if queries > QUERIES_PER_SESSION {
            return Err(model_budget("session cfg query budget exceeded"));
        }
        let mut atoms = BTreeSet::new();
        normalized.atoms(&mut atoms);
        if normalized.nodes() > NODES_PER_EXPRESSION || atoms.len() > ATOMS_PER_EXPRESSION {
            return Err(model_budget("cfg expression budget exceeded"));
        }
        let symbolic = atoms
            .into_iter()
            .filter(|atom| self.environment.value(atom, universe).is_none())
            .collect::<Vec<_>>();
        let assignments = 1usize
            .checked_shl(symbolic.len() as u32)
            .unwrap_or(usize::MAX);
        if assignments > ASSIGNMENTS_PER_EXPRESSION {
            return Err(model_budget("cfg assignment budget exceeded"));
        }
        let mut values = BTreeMap::new();
        let result = (0..assignments).any(|assignment| {
            values.clear();
            for (index, atom) in symbolic.iter().enumerate() {
                values.insert(atom.clone(), assignment & (1 << index) != 0);
            }
            normalized.evaluate(universe, &self.environment, &values)
        });
        self.memo
            .borrow_mut()
            .insert((universe, normalized), result);
        Ok(result)
    }

    #[cfg(test)]
    fn regular_possible(&mut self, projection: &AttributeProjection) -> Result<bool, FatalError> {
        let carriers = CfgExpr::any(
            projection
                .test_carriers()
                .into_iter()
                .map(|carrier| carrier.guard.clone()),
        );
        self.possible(
            &CfgExpr::all([projection.item_guard.clone(), CfgExpr::not(carriers)]),
            Universe::Production,
        )
    }

    #[cfg(test)]
    fn test_possible(&mut self, projection: &AttributeProjection) -> Result<bool, FatalError> {
        let carriers = CfgExpr::any(
            projection
                .test_carriers()
                .into_iter()
                .map(|carrier| carrier.guard.clone()),
        );
        self.possible(
            &CfgExpr::all([projection.item_guard.clone(), carriers]),
            Universe::Test,
        )
    }
}

impl AttributeProjection {
    pub(crate) fn direct_attributes(&self) -> impl Iterator<Item = &OrderedAttributeFact> {
        self.ordered
            .iter()
            .filter(|fact| fact.origin == AttributeOrigin::Direct)
    }

    pub(crate) fn ordered_attributes(&self) -> impl Iterator<Item = &OrderedAttributeFact> {
        let mut facts = self.ordered.iter().collect::<Vec<_>>();
        facts.sort_by(|left, right| {
            left.source_ordinal
                .cmp(&right.source_ordinal)
                .then_with(|| left.conditional_path.cmp(&right.conditional_path))
                .then_with(|| left.origin.cmp(&right.origin))
        });
        facts.into_iter()
    }

    pub(crate) fn test_carriers(&self) -> Vec<TestCarrier> {
        self.ordered
            .iter()
            .filter_map(|fact| {
                direct_test_carrier(
                    &fact.meta,
                    fact.source_ordinal,
                    fact.guard.clone(),
                    fact.location,
                    fact.origin == AttributeOrigin::Conditional,
                )
            })
            .collect()
    }
}

impl CfgExpr {
    pub(crate) fn not(expression: CfgExpr) -> Self {
        Self::Not(Box::new(expression)).normalize()
    }

    pub(crate) fn all(expressions: impl IntoIterator<Item = CfgExpr>) -> Self {
        Self::All(expressions.into_iter().collect()).normalize()
    }

    pub(crate) fn any(expressions: impl IntoIterator<Item = CfgExpr>) -> Self {
        Self::Any(expressions.into_iter().collect()).normalize()
    }

    pub(crate) fn canonical(&self) -> String {
        match self {
            Self::True => "true".to_owned(),
            Self::False => "false".to_owned(),
            Self::Atom(atom) => format!("atom({atom})"),
            Self::Not(expression) => format!("not({})", expression.canonical()),
            Self::All(expressions) => format!(
                "all({})",
                expressions
                    .iter()
                    .map(Self::canonical)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Self::Any(expressions) => format!(
                "any({})",
                expressions
                    .iter()
                    .map(Self::canonical)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        }
    }

    fn normalize(self) -> Self {
        match self {
            Self::Not(expression) => match expression.normalize() {
                Self::True => Self::False,
                Self::False => Self::True,
                Self::Not(inner) => *inner,
                other => Self::Not(Box::new(other)),
            },
            Self::All(expressions) => normalize_list(expressions, true),
            Self::Any(expressions) => normalize_list(expressions, false),
            other => other,
        }
    }

    fn nodes(&self) -> usize {
        match self {
            Self::Not(expression) => 1 + expression.nodes(),
            Self::All(expressions) | Self::Any(expressions) => {
                1 + expressions.iter().map(Self::nodes).sum::<usize>()
            }
            Self::True | Self::False | Self::Atom(_) => 1,
        }
    }

    fn atoms(&self, atoms: &mut BTreeSet<String>) {
        match self {
            Self::Atom(atom) => {
                atoms.insert(atom.clone());
            }
            Self::Not(expression) => expression.atoms(atoms),
            Self::All(expressions) | Self::Any(expressions) => {
                for expression in expressions {
                    expression.atoms(atoms);
                }
            }
            Self::True | Self::False => {}
        }
    }

    fn evaluate(
        &self,
        universe: Universe,
        environment: &CfgEnvironment,
        values: &BTreeMap<String, bool>,
    ) -> bool {
        match self {
            Self::True => true,
            Self::False => false,
            Self::Atom(atom) => environment
                .value(atom, universe)
                .or_else(|| values.get(atom).copied())
                .unwrap_or(false),
            Self::Not(expression) => !expression.evaluate(universe, environment, values),
            Self::All(expressions) => expressions
                .iter()
                .all(|expression| expression.evaluate(universe, environment, values)),
            Self::Any(expressions) => expressions
                .iter()
                .any(|expression| expression.evaluate(universe, environment, values)),
        }
    }
}

#[doc = "ousia: ownerless-fn cfg expression normalization"]
fn normalize_list(expressions: Vec<CfgExpr>, conjunction: bool) -> CfgExpr {
    let mut normalized = Vec::new();
    for expression in expressions.into_iter().map(CfgExpr::normalize) {
        match expression {
            CfgExpr::True if conjunction => {}
            CfgExpr::False if !conjunction => {}
            CfgExpr::False if conjunction => return CfgExpr::False,
            CfgExpr::True => return CfgExpr::True,
            CfgExpr::All(nested) if conjunction => normalized.extend(nested),
            CfgExpr::Any(nested) if !conjunction => normalized.extend(nested),
            other => normalized.push(other),
        }
    }
    normalized.sort();
    normalized.dedup();
    if normalized.is_empty() {
        return if conjunction {
            CfgExpr::True
        } else {
            CfgExpr::False
        };
    }
    if normalized.len() == 1 {
        return normalized.pop().expect("single normalized expression");
    }
    if conjunction {
        CfgExpr::All(normalized)
    } else {
        CfgExpr::Any(normalized)
    }
}

#[doc = "ousia: ownerless-fn cfg grammar parsing"]
fn parse_cfg_attribute(attribute: &Attribute, path: &Path) -> Result<CfgExpr, FatalError> {
    let Meta::List(list) = &attribute.meta else {
        return Err(cfg_syntax(path, attribute, "cfg requires a predicate"));
    };
    syn::parse2::<Meta>(list.tokens.clone())
        .map_err(|error| cfg_syntax(path, attribute, error))
        .and_then(|meta| meta_expression(meta, path, attribute))
}

#[doc = "ousia: ownerless-fn cfg meta expression parsing"]
fn meta_expression(meta: Meta, path: &Path, attribute: &Attribute) -> Result<CfgExpr, FatalError> {
    match meta {
        Meta::List(list) if list.path.is_ident("all") || list.path.is_ident("any") => {
            let conjunction = list.path.is_ident("all");
            let parser = Punctuated::<Meta, Token![,]>::parse_terminated;
            let nested = parser
                .parse2(list.tokens)
                .map_err(|error| cfg_syntax(path, attribute, error))?
                .into_iter()
                .map(|meta| meta_expression(meta, path, attribute))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(if conjunction {
                CfgExpr::all(nested)
            } else {
                CfgExpr::any(nested)
            })
        }
        Meta::List(list) if list.path.is_ident("not") => {
            let nested = syn::parse2::<Meta>(list.tokens)
                .map_err(|error| cfg_syntax(path, attribute, error))?;
            meta_expression(nested, path, attribute).map(CfgExpr::not)
        }
        other => Ok(CfgExpr::Atom(other.to_token_stream().to_string())),
    }
}

#[doc = "ousia: ownerless-fn cfg_attr projection"]
fn project_cfg_attr(
    attribute: &Attribute,
    inherited_guard: CfgExpr,
    ordinal: usize,
    conditional_path: Vec<usize>,
    path: &Path,
    projection: &mut AttributeProjection,
) -> Result<(), FatalError> {
    let Meta::List(list) = &attribute.meta else {
        return Err(cfg_syntax(path, attribute, "cfg_attr requires arguments"));
    };
    let parser = Punctuated::<Meta, Token![,]>::parse_terminated;
    let items = parser
        .parse2(list.tokens.clone())
        .map_err(|error| cfg_syntax(path, attribute, error))?;
    let mut items = items.into_iter();
    let condition = items
        .next()
        .map(|meta| meta_expression(meta, path, attribute))
        .transpose()?
        .ok_or_else(|| cfg_syntax(path, attribute, "cfg_attr requires a condition"))?;
    let guard = CfgExpr::all([inherited_guard, condition]);
    for (payload_ordinal, meta) in items.enumerate() {
        let mut payload_path = conditional_path.clone();
        payload_path.push(payload_ordinal);
        if meta.path().is_ident("cfg_attr") {
            let nested = Attribute {
                pound_token: attribute.pound_token,
                style: attribute.style,
                bracket_token: attribute.bracket_token,
                meta,
            };
            project_cfg_attr(
                &nested,
                guard.clone(),
                ordinal,
                payload_path,
                path,
                projection,
            )?;
        } else if meta.path().is_ident("cfg") {
            let Meta::List(list) = meta else {
                return Err(cfg_syntax(path, attribute, "cfg requires a predicate"));
            };
            let nested = syn::parse2::<Meta>(list.tokens)
                .map_err(|error| cfg_syntax(path, attribute, error))?;
            let nested = meta_expression(nested, path, attribute)?;
            projection.item_guard = CfgExpr::all([
                projection.item_guard.clone(),
                CfgExpr::any([CfgExpr::not(guard.clone()), nested]),
            ]);
        } else {
            projection.ordered.push(OrderedAttributeFact {
                meta: meta.clone(),
                source_ordinal: ordinal,
                conditional_path: payload_path,
                guard: guard.clone(),
                location: attribute.span().start(),
                origin: AttributeOrigin::Conditional,
                class: classify_attribute(&meta),
            });
            if let Some(value) = path_value(&meta) {
                projection.path_alternatives.push((guard.clone(), value));
            }
        }
    }
    Ok(())
}

#[doc = "ousia: ownerless-fn neutral attribute classification"]
fn classify_attribute(meta: &Meta) -> AttributeClass {
    let path = meta.path();
    if path.is_ident("cfg") {
        AttributeClass::Cfg
    } else if path.is_ident("cfg_attr") {
        AttributeClass::CfgAttr
    } else if path.is_ident("doc") {
        AttributeClass::Doc
    } else if path.is_ident("path") {
        AttributeClass::Path
    } else if path.is_ident("derive") {
        AttributeClass::Derive
    } else if path.is_ident("test") || path.is_ident("rstest") || is_runtime_test_path(path) {
        AttributeClass::TestLike
    } else if path
        .segments
        .first()
        .is_some_and(|segment| segment.ident == "case")
    {
        AttributeClass::RstestCase
    } else if path.is_ident("ignore") {
        AttributeClass::Ignore
    } else {
        AttributeClass::Other
    }
}

#[doc = "ousia: ownerless-fn source-visible runtime test carrier path classification"]
fn is_runtime_test_path(path: &syn::Path) -> bool {
    path.segments.len() > 1
        && path
            .segments
            .last()
            .is_some_and(|segment| segment.ident == "test")
}

#[doc = "ousia: ownerless-fn typed test carrier classification"]
fn direct_test_carrier(
    meta: &Meta,
    ordinal: usize,
    guard: CfgExpr,
    location: LineColumn,
    conditional: bool,
) -> Option<TestCarrier> {
    let last = meta.path().segments.last()?.ident.to_string();
    let kind = if last == "rstest" {
        TestCarrierKind::Rstest
    } else if last == "test" && meta.path().is_ident("test") {
        TestCarrierKind::Test
    } else if last == "test" {
        TestCarrierKind::RuntimeTest
    } else {
        return None;
    };
    Some(TestCarrier {
        kind,
        path: meta.path().to_token_stream().to_string().replace(' ', ""),
        ordinal,
        guard,
        location,
        conditional,
        valid_shape: kind != TestCarrierKind::Test || matches!(meta, Meta::Path(_)),
    })
}

#[doc = "ousia: ownerless-fn path attribute value projection"]
fn path_value(meta: &Meta) -> Option<String> {
    let Meta::NameValue(value) = meta else {
        return None;
    };
    if !value.path.is_ident("path") {
        return None;
    }
    let syn::Expr::Lit(value) = &value.value else {
        return None;
    };
    let syn::Lit::Str(value) = &value.lit else {
        return None;
    };
    Some(value.value())
}

#[doc = "ousia: ownerless-fn cfg syntax error mapping"]
fn cfg_syntax(path: &Path, attribute: &Attribute, error: impl std::fmt::Display) -> FatalError {
    FatalError::new(FatalPhase::Graph, "cfg-syntax-invalid", error.to_string())
        .at_path(path)
        .at_location(syn::spanned::Spanned::span(attribute).start())
}

#[doc = "ousia: ownerless-fn cfg model budget error mapping"]
fn model_budget(message: &str) -> FatalError {
    FatalError::new(FatalPhase::Model, "model-budget-exhausted", message)
}

#[doc = "ousia: ownerless-fn rustc platform cfg classification"]
fn is_platform_atom(atom: &str) -> bool {
    matches!(
        atom,
        "unix" | "windows" | "debug_assertions" | "proc_macro" | "target_thread_local"
    ) || atom.starts_with("target_")
        || atom.starts_with("panic =")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Goal: preserve shared symbolic atoms when projecting conditional test carriers.
    /// Scope: level=contract; boundary=analysis::cfg::CfgModel
    /// Semantics: mutually exclusive item and carrier guards create no test occurrence while the production occurrence remains possible.
    #[test]
    fn item_and_test_carrier_projection_share_atom_identity() {
        let file = syn::parse_file(
            r#"#[cfg(feature = "x")]
#[cfg_attr(not(feature = "x"), test)]
fn candidate() {}"#,
        )
        .expect("parse cfg fixture");
        let syn::Item::Fn(function) = &file.items[0] else {
            panic!("expected function fixture");
        };
        let mut model = CfgModel::new(CfgEnvironment::fixture(&[]));
        let projection = model
            .attributes(&function.attrs, Path::new("fixture.rs"))
            .expect("project attributes");

        assert!(model.regular_possible(&projection).expect("production SAT"));
        assert!(!model.test_possible(&projection).expect("test SAT"));
    }

    /// Goal: prevent impossible platform combinations from becoming graph ambiguity evidence.
    /// Scope: level=contract; boundary=analysis::cfg::CfgModel
    /// Semantics: windows is false in a unix fixture and the two platform guards cannot both activate.
    #[test]
    fn platform_atoms_use_the_discovered_cfg_environment() {
        let model = CfgModel::new(CfgEnvironment::fixture(&["unix"]));
        let both = CfgExpr::all([
            CfgExpr::Atom("unix".to_owned()),
            CfgExpr::Atom("windows".to_owned()),
        ]);

        assert!(
            !model
                .possible(&both, Universe::Production)
                .expect("platform SAT")
        );
    }

    /// Goal: reject malformed nested cfg predicates before graph or report evaluation.
    /// Scope: level=contract; boundary=analysis::cfg::CfgModel::attributes
    /// Semantics: malformed all/not grammar returns cfg-syntax-invalid rather than becoming an impossible branch.
    #[rstest::rstest]
    #[case::malformed_all("#[cfg(all(feature = \"x\", =))]")]
    #[case::malformed_not("#[cfg(not(feature = \"x\", unix))]")]
    fn malformed_nested_cfg_is_fatal(#[case] attribute: &str) {
        let source = format!("{attribute}\nfn candidate() {{}}");
        let file = syn::parse_file(&source).expect("parse Rust attribute fixture");
        let syn::Item::Fn(function) = &file.items[0] else {
            panic!("expected function fixture");
        };
        let model = CfgModel::new(CfgEnvironment::fixture(&[]));

        let error = match model.attributes(&function.attrs, Path::new("fixture.rs")) {
            Ok(_) => panic!("malformed cfg grammar unexpectedly passed"),
            Err(error) => error,
        };

        assert_eq!(error.code(), "cfg-syntax-invalid");
    }
}
