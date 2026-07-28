use syn::{FnArg, ReturnType, Type};

pub(crate) fn impl_self_type_name(ty: &Type) -> Option<String> {
    let Type::Path(path) = ty else {
        return None;
    };
    if path.qself.is_some() {
        return None;
    }
    path.path
        .segments
        .last()
        .map(|segment| segment.ident.to_string())
}

pub(super) fn method_signature_mentions_self_type(
    signature: &syn::Signature,
    self_type: &str,
) -> bool {
    signature.inputs.iter().any(|input| match input {
        FnArg::Receiver(_) => true,
        FnArg::Typed(input) => type_mentions_self_type(&input.ty, self_type),
    }) || match &signature.output {
        ReturnType::Default => false,
        ReturnType::Type(_, ty) => type_mentions_self_type(ty, self_type),
    }
}

fn type_mentions_self_type(ty: &Type, self_type: &str) -> bool {
    match ty {
        Type::Path(path) => {
            path.path
                .segments
                .iter()
                .any(|segment| segment.ident == "Self" || segment.ident == self_type)
                || path.path.segments.iter().any(|segment| {
                    angle_bracketed_args_mention_self_type(&segment.arguments, self_type)
                })
        }
        Type::Reference(value) => type_mentions_self_type(&value.elem, self_type),
        Type::Slice(value) => type_mentions_self_type(&value.elem, self_type),
        Type::Array(value) => type_mentions_self_type(&value.elem, self_type),
        Type::Tuple(value) => value
            .elems
            .iter()
            .any(|ty| type_mentions_self_type(ty, self_type)),
        Type::Paren(value) => type_mentions_self_type(&value.elem, self_type),
        Type::Group(value) => type_mentions_self_type(&value.elem, self_type),
        Type::Ptr(value) => type_mentions_self_type(&value.elem, self_type),
        _ => false,
    }
}

fn angle_bracketed_args_mention_self_type(arguments: &syn::PathArguments, self_type: &str) -> bool {
    let syn::PathArguments::AngleBracketed(arguments) = arguments else {
        return false;
    };
    arguments.args.iter().any(|argument| match argument {
        syn::GenericArgument::Type(ty) => type_mentions_self_type(ty, self_type),
        syn::GenericArgument::AssocType(value) => type_mentions_self_type(&value.ty, self_type),
        syn::GenericArgument::Constraint(value) => value
            .bounds
            .iter()
            .any(|bound| type_param_bound_mentions_self_type(bound, self_type)),
        _ => false,
    })
}

fn type_param_bound_mentions_self_type(bound: &syn::TypeParamBound, self_type: &str) -> bool {
    let syn::TypeParamBound::Trait(bound) = bound else {
        return false;
    };
    bound.path.segments.iter().any(|segment| {
        segment.ident == "Self"
            || segment.ident == self_type
            || angle_bracketed_args_mention_self_type(&segment.arguments, self_type)
    })
}
