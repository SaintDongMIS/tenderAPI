function toDDM(latOrLng) {
  const degreeInteger = Math.floor(latOrLng);
  const degreeMinute = (latOrLng % 1) * 60;
  const degreeMinuteIntegerPart = Math.floor(degreeMinute);
  const degreeMinutePointPart = parseFloat(
    (degreeMinute % 1).toFixed(4).replace("0.", "")
  );
  return [degreeInteger, degreeMinuteIntegerPart, degreeMinutePointPart];
}

function toDDMText(latOrLng, hasDot = false) {
  const [degreeInteger, degreeMinuteIntegerPart, degreeMinutePointPart] =
    toDDM(latOrLng);
  const degreeMinuteIntegerText = `${degreeMinuteIntegerPart}`.padStart(2, "0");
  const degreeMinutePointText = `${degreeMinutePointPart}`.padStart(4, "0");
  return `${degreeInteger}${
    hasDot ? "." : ""
  }${degreeMinuteIntegerText}${degreeMinutePointText}`;
}

exports.toDDM = toDDM;
exports.toDDMText = toDDMText;
