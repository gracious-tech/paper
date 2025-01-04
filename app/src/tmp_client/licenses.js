function filter_licenses(licenses, usage) {
  return licenses.filter((license) => {
    const r = license.restrictions;
    return (!usage.commercial || !r.forbid_commercial) && (!usage.attributionless || !r.forbid_attributionless) && (!usage.derivatives || !r.forbid_derivatives || usage.derivatives === "same-license" && r.forbid_derivatives === "same-license") && (!usage.limitless || !r.forbid_limitless);
  });
}
export {
  filter_licenses
};
//# sourceMappingURL=licenses.js.map
