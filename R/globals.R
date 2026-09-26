# dplyr provides the .data pronoun inside its data mask; rlang is not imported,
# so declare it for codetools and lintr.
utils::globalVariables(".data")
