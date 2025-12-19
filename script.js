document.getElementById("draftBtn").onclick = function () {
  document.getElementById("reviewText").value =
    "Will did an awesome job detailing my vehicle at Royal Detailing. 
    He was professional, thorough, and paid attention to every detail. 
    I would definitely recommend Will and Royal Detailing to anyone.";
};

document.getElementById("copyBtn").onclick = function () {
  const text = document.getElementById("reviewText");
  text.select();
  document.execCommand("copy");
  alert("Review copied!");
};

