use std::collections::BTreeSet;

use proc_macro2::{TokenStream, TokenTree};
use quote::ToTokens;
use syn::parse::Parser;
use syn::punctuated::Punctuated;
use syn::visit::{self, Visit};
use syn::{Expr, ItemFn, ReturnType, Token};

use super::model::{OracleLiteral, TestFacts};

#[derive(Default)]
struct OracleVisitor {
    oracles: BTreeSet<&'static str>,
    oracle_literals: BTreeSet<OracleLiteral>,
}

impl TestFacts {
    pub(super) fn from_function(
        function: &ItemFn,
        body_facts: &crate::analysis::callables::BodyFacts,
    ) -> Self {
        let mut visitor = OracleVisitor::default();
        visitor.visit_block(&function.block);
        for attribute in &function.attrs {
            if attribute.path().is_ident("should_panic") {
                visitor.oracles.insert("should-panic");
            }
        }
        if let ReturnType::Type(_, value) = &function.sig.output
            && let syn::Type::Path(path) = value.as_ref()
            && path
                .path
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "Result")
        {
            visitor.oracles.insert("result");
        }
        Self {
            direct_function_calls: body_facts.direct_function_calls.iter().cloned().collect(),
            receiver_methods: body_facts.receiver_methods.iter().cloned().collect(),
            oracles: visitor.oracles.into_iter().collect(),
            oracle_literals: visitor.oracle_literals.into_iter().collect(),
        }
    }
}

impl<'ast> Visit<'ast> for OracleVisitor {
    fn visit_macro(&mut self, expression: &'ast syn::Macro) {
        if let Some(kind) = normalized_oracle_kind(&expression.path) {
            self.oracles.insert(kind);
            let parser = Punctuated::<Expr, Token![,]>::parse_terminated;
            if let Ok(arguments) = parser.parse2(expression.tokens.clone()) {
                for (argument, expression) in arguments.iter().enumerate() {
                    collect_literals(
                        kind,
                        argument,
                        expression.to_token_stream(),
                        &mut self.oracle_literals,
                    );
                    self.visit_expr(expression);
                }
            }
        }
    }

    fn visit_expr_try(&mut self, expression: &'ast syn::ExprTry) {
        self.oracles.insert("try");
        visit::visit_expr_try(self, expression);
    }

    fn visit_item_fn(&mut self, _function: &'ast ItemFn) {}
}

#[doc = "ousia: ownerless-fn assertion macro normalization for test inventory"]
fn normalized_oracle_kind(path: &syn::Path) -> Option<&'static str> {
    match path.segments.last()?.ident.to_string().as_str() {
        "assert" | "debug_assert" => Some("assert"),
        "assert_eq" | "debug_assert_eq" => Some("assert-eq"),
        "assert_ne" | "debug_assert_ne" => Some("assert-ne"),
        "matches" | "assert_matches" => Some("matches"),
        "panic" => Some("panic"),
        _ => None,
    }
}

#[doc = "ousia: ownerless-fn literal collection for oracle evidence"]
fn collect_literals(
    oracle: &'static str,
    argument: usize,
    tokens: TokenStream,
    literals: &mut BTreeSet<OracleLiteral>,
) {
    for token in tokens {
        match token {
            TokenTree::Literal(value) => {
                literals.insert(OracleLiteral {
                    oracle,
                    argument,
                    literal: value.to_string(),
                });
            }
            TokenTree::Group(group) => collect_literals(oracle, argument, group.stream(), literals),
            _ => {}
        }
    }
}
