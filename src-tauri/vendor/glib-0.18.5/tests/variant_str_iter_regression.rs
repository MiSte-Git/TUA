use glib::variant::ToVariant;

#[test]
fn variant_str_iter_regression() {
    let expected = ["", "Grüße", "東京", "last"];
    let variant = expected.to_variant();
    assert_eq!(variant.array_iter_str().unwrap().collect::<Vec<_>>(), expected);
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some(""));
    assert_eq!(iter.next_back(), Some("last"));
    assert_eq!(iter.next(), Some("Grüße"));
    assert_eq!(iter.next_back(), Some("東京"));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(variant.array_iter_str().unwrap().nth(2), Some("東京"));
    assert_eq!(variant.array_iter_str().unwrap().nth_back(2), Some("Grüße"));
    assert_eq!(variant.array_iter_str().unwrap().last(), Some("last"));
    let empty = Vec::<String>::new().to_variant();
    assert_eq!(empty.array_iter_str().unwrap().next(), None);
}
