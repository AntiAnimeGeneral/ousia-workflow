use proc_macro2::{TokenStream, TokenTree};
use quote::ToTokens;
use sha2::{Digest, Sha256};
use syn::ItemFn;

use super::model::TestFingerprints;

impl TestFingerprints {
    pub(super) fn from_function(function: &ItemFn) -> Self {
        let mut comparison = function.clone();
        comparison.sig.ident = syn::Ident::new("test", comparison.sig.ident.span());
        comparison
            .attrs
            .retain(|attribute| !attribute.path().is_ident("doc"));
        let exact = comparison.to_token_stream();
        let normalized = normalize_literals(exact.clone());
        Self {
            exact_body_sha256: hash_tokens(exact),
            literal_normalized_sha256: hash_tokens(normalized),
        }
    }
}

#[doc = "ousia: ownerless-fn token literal normalization for test fingerprints"]
fn normalize_literals(tokens: TokenStream) -> TokenStream {
    tokens
        .into_iter()
        .map(|token| match token {
            TokenTree::Literal(value) => TokenTree::Ident(syn::Ident::new(
                literal_kind(&value.to_string()),
                value.span(),
            )),
            TokenTree::Group(group) => {
                let mut normalized =
                    proc_macro2::Group::new(group.delimiter(), normalize_literals(group.stream()));
                normalized.set_span(group.span());
                TokenTree::Group(normalized)
            }
            other => other,
        })
        .collect()
}

#[doc = "ousia: ownerless-fn Rust literal kind classification for normalized fingerprints"]
fn literal_kind(value: &str) -> &'static str {
    if value.starts_with('"') || value.starts_with("r#") {
        "string_literal"
    } else if value.starts_with('b') && value.contains('"') {
        "byte_string_literal"
    } else if value.starts_with('\'') {
        "char_literal"
    } else if value == "true" || value == "false" {
        "bool_literal"
    } else if value.contains('.') || value.contains('e') || value.contains('E') {
        "float_literal"
    } else {
        "integer_literal"
    }
}

#[doc = "ousia: ownerless-fn deterministic SHA-256 token hashing for test inventory"]
fn hash_tokens(tokens: TokenStream) -> String {
    format!("{:x}", Sha256::digest(tokens.to_string().as_bytes()))
}
